"""
Two-tower trainer v2: now with image features in the item tower.
"""
import argparse
import json
import os
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.metrics import roc_auc_score

ROOT = Path(__file__).parent.parent
DATA_PATH = ROOT / "data" / "training.json"
CKPT_DIR = Path(__file__).parent / "checkpoints"
CKPT_DIR.mkdir(parents=True, exist_ok=True)


def load_data():
    print(f"Loading {DATA_PATH} ...")
    with open(DATA_PATH) as f:
        data = json.load(f)
    meta = data["meta"]
    print(f"  meta: {meta}")
    return {
        "meta": meta,
        "user_embs": np.array(data["user_embs"], dtype=np.float32),
        "user_scalars": np.array(data["user_scalars"], dtype=np.float32),
        "item_text_embs": np.array(data["item_text_embs"], dtype=np.float32),
        "item_image_embs": np.array(data["item_image_embs"], dtype=np.float32),
        "item_image_present": np.array(data["item_image_present"], dtype=np.float32),
        "item_scalars": np.array(data["item_scalars"], dtype=np.float32),
        "label_u": np.array([r["u"] for r in data["labels"]], dtype=np.int64),
        "label_i": np.array([r["i"] for r in data["labels"]], dtype=np.int64),
        "label_y": np.array([r["y"] for r in data["labels"]], dtype=np.float32),
    }


class UserTower(nn.Module):
    def __init__(self, emb_dim, scalar_dim, hidden=256, out=128, dropout=0.2):
        super().__init__()
        self.fc1 = nn.Linear(emb_dim + scalar_dim, hidden)
        self.ln1 = nn.LayerNorm(hidden)
        self.fc2 = nn.Linear(hidden, hidden)
        self.ln2 = nn.LayerNorm(hidden)
        self.fc3 = nn.Linear(hidden, out)
        self.dropout = nn.Dropout(dropout)
        self.act = nn.GELU()

    def forward(self, emb, scalars):
        x = torch.cat([emb, scalars], dim=-1)
        x = self.dropout(self.act(self.ln1(self.fc1(x))))
        x = self.dropout(self.act(self.ln2(self.fc2(x))))
        return F.normalize(self.fc3(x), dim=-1)


class ItemTower(nn.Module):
    """Now takes text_emb (1536), image_emb (768, zero if absent), scalars (4)."""
    def __init__(self, text_dim, image_dim, scalar_dim, hidden=256, out=128, dropout=0.2):
        super().__init__()
        # Project image separately first (helps when 60%+ of items have zero image emb)
        self.image_proj = nn.Linear(image_dim, 128)
        self.fc1 = nn.Linear(text_dim + 128 + scalar_dim, hidden)
        self.ln1 = nn.LayerNorm(hidden)
        self.fc2 = nn.Linear(hidden, hidden)
        self.ln2 = nn.LayerNorm(hidden)
        self.fc3 = nn.Linear(hidden, out)
        self.dropout = nn.Dropout(dropout)
        self.act = nn.GELU()

    def forward(self, text_emb, image_emb, scalars):
        img_proj = self.act(self.image_proj(image_emb))
        x = torch.cat([text_emb, img_proj, scalars], dim=-1)
        x = self.dropout(self.act(self.ln1(self.fc1(x))))
        x = self.dropout(self.act(self.ln2(self.fc2(x))))
        return F.normalize(self.fc3(x), dim=-1)


class TwoTower(nn.Module):
    def __init__(self, user_emb_dim, user_scalar_dim, text_dim, image_dim, item_scalar_dim, out_dim=128):
        super().__init__()
        self.user = UserTower(user_emb_dim, user_scalar_dim, out=out_dim)
        self.item = ItemTower(text_dim, image_dim, item_scalar_dim, out=out_dim)
        self.temperature = nn.Parameter(torch.tensor(8.0))

    def forward(self, ue, us, ite, iie, isc):
        uv = self.user(ue, us)
        iv = self.item(ite, iie, isc)
        return (uv * iv).sum(dim=-1) * self.temperature


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--wd", type=float, default=1e-4)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"device: {device}")

    d = load_data()
    meta = d["meta"]
    n = len(d["label_y"])
    print(f"Total labels: {n}")

    rng = np.random.RandomState(args.seed)
    perm = rng.permutation(n)
    val_size = max(200, int(0.15 * n))
    val_idx = perm[:val_size]
    train_idx = perm[val_size:]
    print(f"train: {len(train_idx)}, val: {len(val_idx)}")
    print(f"pos rate train: {d['label_y'][train_idx].mean():.3f}, val: {d['label_y'][val_idx].mean():.3f}")

    def gather(idxs):
        return (
            torch.from_numpy(d["user_embs"][d["label_u"][idxs]]).to(device),
            torch.from_numpy(d["user_scalars"][d["label_u"][idxs]]).to(device),
            torch.from_numpy(d["item_text_embs"][d["label_i"][idxs]]).to(device),
            torch.from_numpy(d["item_image_embs"][d["label_i"][idxs]]).to(device),
            torch.from_numpy(d["item_scalars"][d["label_i"][idxs]]).to(device),
            torch.from_numpy(d["label_y"][idxs]).to(device),
        )

    tr_ue, tr_us, tr_ite, tr_iie, tr_isc, tr_y = gather(train_idx)
    va_ue, va_us, va_ite, va_iie, va_isc, va_y = gather(val_idx)

    model = TwoTower(
        user_emb_dim=meta["user_emb_dim"],
        user_scalar_dim=meta["user_scalar_dim"],
        text_dim=meta["item_text_dim"],
        image_dim=meta["item_image_dim"],
        item_scalar_dim=meta["item_scalar_dim"],
    ).to(device)
    print(f"params: {sum(p.numel() for p in model.parameters()) / 1e6:.2f}M")

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.wd)
    pos_weight = torch.tensor((1 - d["label_y"].mean()) / max(d["label_y"].mean(), 1e-3)).to(device)
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=pos_weight)

    best_val_auc = 0.0
    no_improve = 0
    history = []

    for epoch in range(1, args.epochs + 1):
        model.train()
        perm_tr = torch.randperm(len(train_idx))
        train_loss = 0.0
        n_batches = 0
        for b in range(0, len(train_idx), args.batch):
            sl = perm_tr[b: b + args.batch]
            logits = model(tr_ue[sl], tr_us[sl], tr_ite[sl], tr_iie[sl], tr_isc[sl])
            loss = loss_fn(logits, tr_y[sl])
            opt.zero_grad()
            loss.backward()
            opt.step()
            train_loss += loss.item()
            n_batches += 1
        train_loss /= n_batches

        model.eval()
        with torch.no_grad():
            va_logits = model(va_ue, va_us, va_ite, va_iie, va_isc)
            val_loss = loss_fn(va_logits, va_y).item()
            probs = torch.sigmoid(va_logits).cpu().numpy()
            yn = va_y.cpu().numpy()
            try:
                val_auc = roc_auc_score(yn, probs)
            except ValueError:
                val_auc = float("nan")
            val_acc = ((probs > 0.5) == (yn > 0.5)).mean()

        history.append({
            "epoch": epoch, "train_loss": train_loss, "val_loss": val_loss,
            "val_auc": float(val_auc), "val_acc": float(val_acc),
        })
        marker = ""
        if val_auc > best_val_auc:
            best_val_auc = val_auc
            no_improve = 0
            torch.save(model.state_dict(), CKPT_DIR / "best.pt")
            marker = " ✓ saved"
        else:
            no_improve += 1
        print(f"epoch {epoch:3d}  train_loss={train_loss:.4f}  val_loss={val_loss:.4f}  val_auc={val_auc:.4f}  val_acc={val_acc:.3f}{marker}")
        if no_improve >= 7:
            print("  early stop"); break

    model.load_state_dict(torch.load(CKPT_DIR / "best.pt", map_location=device))
    model.eval()
    print(f"\nbest val AUC: {best_val_auc:.4f}")

    # Export ONNX
    torch.onnx.export(
        model.user,
        (torch.zeros(1, meta["user_emb_dim"]).to(device), torch.zeros(1, meta["user_scalar_dim"]).to(device)),
        str(CKPT_DIR / "user_tower.onnx"),
        input_names=["emb", "scalars"],
        output_names=["user_vec"],
        dynamic_axes={"emb": {0: "batch"}, "scalars": {0: "batch"}, "user_vec": {0: "batch"}},
        opset_version=17,
    )
    torch.onnx.export(
        model.item,
        (
            torch.zeros(1, meta["item_text_dim"]).to(device),
            torch.zeros(1, meta["item_image_dim"]).to(device),
            torch.zeros(1, meta["item_scalar_dim"]).to(device),
        ),
        str(CKPT_DIR / "item_tower.onnx"),
        input_names=["text_emb", "image_emb", "scalars"],
        output_names=["item_vec"],
        dynamic_axes={
            "text_emb": {0: "batch"},
            "image_emb": {0: "batch"},
            "scalars": {0: "batch"},
            "item_vec": {0: "batch"},
        },
        opset_version=17,
    )
    with open(CKPT_DIR / "metrics.json", "w") as f:
        json.dump({"best_val_auc": best_val_auc, "history": history, "meta": meta}, f, indent=2)
    print(f"\n✓ user_tower.onnx + item_tower.onnx exported")


if __name__ == "__main__":
    main()
