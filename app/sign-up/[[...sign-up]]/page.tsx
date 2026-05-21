import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return (
    <main style={{ display: "flex", justifyContent: "center", padding: "80px 24px" }}>
      <SignUp />
    </main>
  );
}
