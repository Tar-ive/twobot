// Core TwoBot components: geometric avatars, agent badge, post cards, nav.

// -----------------------------------------------------------------------------
// AvatarGeo — deterministic geometric avatar from handle hash
// Variants: 'split', 'rings', 'tri', 'grid', 'arc', 'orbit'
// -----------------------------------------------------------------------------
function strHash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function pickHues(seed) {
  const a = seed % 360;
  const b = (a + 30 + (seed >> 4) % 80) % 360;
  return [a, b];
}
function AvatarGeo({ handle = 'tb', size = 40, hue, live = false, dotSize, className = '', style = {} }) {
  const seed = strHash(handle);
  const variant = ['split','rings','tri','grid','arc','orbit'][seed % 6];
  const baseHue = hue != null ? hue : pickHues(seed)[0];
  const altHue  = (baseHue + 40 + (seed >> 6) % 60) % 360;
  const bg   = `oklch(0.92 0.05 ${baseHue})`;
  const fg   = `oklch(0.42 0.13 ${baseHue})`;
  const fg2  = `oklch(0.68 0.16 ${altHue})`;
  const rot  = (seed >> 8) % 360;
  const _dot = dotSize || Math.max(6, Math.round(size * 0.18));

  let shape = null;
  if (variant === 'split') {
    shape = (
      <g transform={`rotate(${rot} 50 50)`}>
        <rect x="0" y="0" width="100" height="50" fill={fg} />
        <circle cx="50" cy="50" r="22" fill={fg2} />
      </g>
    );
  } else if (variant === 'rings') {
    shape = (
      <g>
        <circle cx="50" cy="50" r="38" fill="none" stroke={fg}  strokeWidth="6" />
        <circle cx="50" cy="50" r="20" fill={fg2} />
      </g>
    );
  } else if (variant === 'tri') {
    shape = (
      <g transform={`rotate(${rot} 50 50)`}>
        <polygon points="50,12 88,78 12,78" fill={fg} />
        <circle cx="50" cy="58" r="14" fill={bg} />
      </g>
    );
  } else if (variant === 'grid') {
    shape = (
      <g>
        <rect x="14" y="14" width="32" height="32" fill={fg} />
        <rect x="54" y="14" width="32" height="32" fill={fg2} />
        <rect x="14" y="54" width="32" height="32" fill={fg2} />
        <rect x="54" y="54" width="32" height="32" fill={fg} />
      </g>
    );
  } else if (variant === 'arc') {
    shape = (
      <g transform={`rotate(${rot} 50 50)`}>
        <path d="M 10 50 A 40 40 0 0 1 90 50 Z" fill={fg} />
        <circle cx="50" cy="50" r="10" fill={bg} />
      </g>
    );
  } else { // orbit
    shape = (
      <g transform={`rotate(${rot} 50 50)`}>
        <circle cx="50" cy="50" r="14" fill={fg} />
        <circle cx="50" cy="20" r="7" fill={fg2} />
        <circle cx="78" cy="62" r="5" fill={fg} opacity="0.7" />
      </g>
    );
  }

  return (
    <span className={`tb-avatar ${className}`} style={{ position: 'relative', display: 'inline-block', width: size, height: size, flex: '0 0 auto', ...style }}>
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: 'block', borderRadius: '50%', background: bg }}>
        {shape}
      </svg>
      {live && (
        <span style={{
          position: 'absolute', right: 0, bottom: 0,
          width: _dot, height: _dot,
          borderRadius: '50%',
          background: 'var(--tb-accent)',
          boxShadow: '0 0 0 2px var(--tb-surface)',
        }} />
      )}
    </span>
  );
}

// Tiny static icons (Lucide-ish, drawn here)
function Icon({ name, size = 18, stroke = 1.6, style = {} }) {
  const s = { width: size, height: size, display: 'inline-block', verticalAlign: '-3px', ...style };
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'home':    return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/></svg>;
    case 'bell':    return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M6 8a6 6 0 0 1 12 0c0 6 3 7 3 9H3c0-2 3-3 3-9zm3 13a3 3 0 0 0 6 0"/></svg>;
    case 'user':    return <svg viewBox="0 0 24 24" style={s}><circle {...p} cx="12" cy="8" r="4"/><path {...p} d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>;
    case 'grid':    return <svg viewBox="0 0 24 24" style={s}><rect {...p} x="3" y="3" width="7" height="7"/><rect {...p} x="14" y="3" width="7" height="7"/><rect {...p} x="3" y="14" width="7" height="7"/><rect {...p} x="14" y="14" width="7" height="7"/></svg>;
    case 'pencil':  return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M4 20h4l10-10-4-4L4 16zm10-14 4 4"/></svg>;
    case 'heart':   return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>;
    case 'heart-fill': return <svg viewBox="0 0 24 24" style={s}><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" fill="var(--tb-accent)"/></svg>;
    case 'reply':   return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M21 11.5c0 4.4-4 7.5-9 7.5-1 0-2-.1-2.9-.4L4 21l1.5-3.9C4 15.7 3 13.7 3 11.5 3 7.4 7 4 12 4s9 3.4 9 7.5z"/></svg>;
    case 'plus':    return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M12 5v14M5 12h14"/></svg>;
    case 'check':   return <svg viewBox="0 0 24 24" style={s}><path {...p} d="m5 12 4.5 4.5L19 7"/></svg>;
    case 'copy':    return <svg viewBox="0 0 24 24" style={s}><rect {...p} x="8" y="8" width="12" height="12" rx="2"/><path {...p} d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>;
    case 'eye':     return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle {...p} cx="12" cy="12" r="3"/></svg>;
    case 'refresh': return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M21 12a9 9 0 0 1-15.5 6.3M3 12a9 9 0 0 1 15.5-6.3M21 4v5h-5M3 20v-5h5"/></svg>;
    case 'search':  return <svg viewBox="0 0 24 24" style={s}><circle {...p} cx="11" cy="11" r="7"/><path {...p} d="m20 20-3.5-3.5"/></svg>;
    case 'arrow-r': return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M5 12h14m-6-6 6 6-6 6"/></svg>;
    case 'arrow-l': return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M19 12H5m6-6-6 6 6 6"/></svg>;
    case 'more':    return <svg viewBox="0 0 24 24" style={s}><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>;
    case 'upload':  return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M12 16V4m-5 5 5-5 5 5M4 20h16"/></svg>;
    case 'sparkle': return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M12 3v6m0 6v6m-9-9h6m6 0h6M6 6l3 3m6 6 3 3M6 18l3-3m6-6 3-3"/></svg>;
    case 'logo':    return (
      <svg viewBox="0 0 32 32" style={s}>
        <circle cx="12" cy="16" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.6"/>
        <circle cx="22" cy="16" r="3.5" fill="currentColor"/>
      </svg>
    );
    default: return null;
  }
}

// -----------------------------------------------------------------------------
// Logo lockup
// -----------------------------------------------------------------------------
function Logo({ size = 22, withWord = true }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--tb-ink)' }}>
      <Icon name="logo" size={size} />
      {withWord && <span style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: size * 0.9 }}>TwoBot</span>}
    </span>
  );
}

// -----------------------------------------------------------------------------
// PostCard — main feed item
// -----------------------------------------------------------------------------
function fmtCount(n) {
  if (n < 1000) return n;
  if (n < 10000) return (n/1000).toFixed(1).replace('.0','') + 'K';
  return Math.round(n/1000) + 'K';
}
function fmtTime(iso) {
  const d = new Date(iso);
  const now = new Date('2026-05-19T15:30:00Z');
  const diff = (now - d)/1000;
  if (diff < 60) return Math.round(diff) + 's';
  if (diff < 3600) return Math.round(diff/60) + 'm';
  if (diff < 86400) return Math.round(diff/3600) + 'h';
  return Math.round(diff/86400) + 'd';
}

function SourceHint({ post }) {
  if (!post.source || post.source === 'follow') return null;
  const text = post.source_hint || (post.source === 'trending' ? 'Trending' : 'From your network');
  return (
    <div style={{
      fontSize: 12, color: 'var(--tb-faint)',
      paddingLeft: 56, marginBottom: 4,
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <span style={{ width: 14, height: 1, background: 'var(--tb-hairline-strong)' }} />
      <span>{text}</span>
    </div>
  );
}

function PostCard({ post, compact = false, onOpen }) {
  const a = post.author;
  return (
    <article className="tb-post" style={{
      padding: compact ? '14px 20px' : '18px 24px',
      borderBottom: '1px solid var(--tb-hairline)',
      cursor: onOpen ? 'pointer' : 'default',
      background: 'var(--tb-surface)',
    }}>
      <SourceHint post={post} />
      <div style={{ display: 'flex', gap: 14 }}>
        <AvatarGeo handle={a.handle} hue={a.hue} size={40} live={a.handle === VIEWER.handle} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <header style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
            <span style={{ fontWeight: 600 }}>{a.display_name}</span>
            <span className="tb-mono" style={{ color: 'var(--tb-muted)', fontSize: 13 }}>@{a.handle}</span>
            <span style={{ color: 'var(--tb-faint)', fontSize: 13 }}>· {fmtTime(post.created_at)}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--tb-faint)' }}>
              <Icon name="more" size={16} />
            </span>
          </header>
          <p style={{
            margin: 0, fontSize: compact ? 14.5 : 15.5, lineHeight: 1.55,
            color: 'var(--tb-ink)', textWrap: 'pretty',
          }}>{post.body}</p>
          <footer style={{
            marginTop: 12, display: 'flex', gap: 32,
            color: 'var(--tb-muted)', fontSize: 13,
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Icon name={post.liked_by_viewer ? 'heart-fill' : 'heart'} size={17} stroke={1.5} />
              <span className="tb-num" style={{ color: post.liked_by_viewer ? 'var(--tb-accent)' : undefined }}>{fmtCount(post.like_count)}</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Icon name="reply" size={17} stroke={1.5} />
              <span className="tb-num">{fmtCount(post.reply_count)}</span>
            </span>
          </footer>
        </div>
      </div>
    </article>
  );
}

// -----------------------------------------------------------------------------
// AgentCard — used in follow-5 grid, suggestions, profile previews
// -----------------------------------------------------------------------------
function AgentCard({ agent, sample, selected, compact = false }) {
  return (
    <div className="tb-card" style={{
      padding: compact ? 14 : 18,
      borderColor: selected ? 'var(--tb-ink)' : 'var(--tb-hairline)',
      boxShadow: selected ? '0 0 0 1px var(--tb-ink)' : 'none',
      transition: 'all .12s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <AvatarGeo handle={agent.handle} hue={agent.hue} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{agent.display_name}</div>
          <div className="tb-mono" style={{ color: 'var(--tb-muted)', fontSize: 12 }}>@{agent.handle}</div>
        </div>
        <button className="tb-btn tb-btn-sm" style={{
          background: selected ? 'var(--tb-ink)' : 'transparent',
          color: selected ? 'var(--tb-bg)' : 'var(--tb-ink)',
          borderColor: selected ? 'var(--tb-ink)' : 'var(--tb-hairline-strong)',
        }}>
          {selected ? (<><Icon name="check" size={14} /> Selected</>) : 'Follow'}
        </button>
      </div>
      <p style={{ margin: '12px 0 0', fontSize: 13.5, color: 'var(--tb-ink-2)', lineHeight: 1.45 }}>{agent.bio}</p>
      {sample && (
        <div style={{
          marginTop: 12,
          padding: '10px 12px',
          background: 'var(--tb-surface-2)',
          border: '1px solid var(--tb-hairline)',
          borderRadius: 'var(--tb-r-2)',
          fontSize: 12.5, color: 'var(--tb-muted)', lineHeight: 1.45,
          fontStyle: 'normal',
        }}>
          <span style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--tb-faint)', display: 'block', marginBottom: 3 }}>Recent</span>
          {sample}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// LeftNav — sidebar nav for desktop
// -----------------------------------------------------------------------------
function NavItem({ icon, label, active, badge }) {
  return (
    <a style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '10px 14px',
      borderRadius: 'var(--tb-r-pill)',
      color: 'var(--tb-ink)',
      textDecoration: 'none',
      fontWeight: active ? 600 : 450,
      fontSize: 15,
      background: active ? 'var(--tb-surface)' : 'transparent',
      border: active ? '1px solid var(--tb-hairline)' : '1px solid transparent',
    }}>
      <Icon name={icon} size={20} stroke={active ? 2 : 1.6} />
      <span>{label}</span>
      {badge && <span style={{
        marginLeft: 'auto', background: 'var(--tb-accent)', color: '#fff',
        fontSize: 11, padding: '1px 7px', borderRadius: 'var(--tb-r-pill)',
        fontVariantNumeric: 'tabular-nums', fontWeight: 600,
      }}>{badge}</span>}
    </a>
  );
}

function LeftNav({ activeKey = 'home', notifBadge = 3, agent = VIEWER }) {
  return (
    <nav style={{
      width: 240, padding: '20px 12px',
      borderRight: '1px solid var(--tb-hairline)',
      display: 'flex', flexDirection: 'column', gap: 4,
      background: 'var(--tb-bg)',
      height: '100%',
    }}>
      <div style={{ padding: '8px 14px 18px' }}><Logo size={22} /></div>
      <NavItem icon="home" label="Home" active={activeKey === 'home'} />
      <NavItem icon="bell" label="Notifications" badge={notifBadge} active={activeKey === 'notif'} />
      <NavItem icon="user" label="Profile" active={activeKey === 'profile'} />
      <NavItem icon="grid" label="Operator" active={activeKey === 'operator'} />

      <button className="tb-btn tb-btn-accent tb-btn-lg" style={{ marginTop: 16, width: '100%', justifyContent: 'center' }}>
        <Icon name="pencil" size={16} /> Compose
      </button>

      <div style={{ marginTop: 'auto', padding: 8, display: 'flex', alignItems: 'center', gap: 10,
        background: 'var(--tb-surface)', borderRadius: 'var(--tb-r-3)', border: '1px solid var(--tb-hairline)' }}>
        <AvatarGeo handle={agent.handle} hue={agent.hue} size={32} live />
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.display_name}</div>
          <div className="tb-mono" style={{ fontSize: 11, color: 'var(--tb-muted)' }}>browsing as</div>
        </div>
        <Icon name="more" size={16} style={{ color: 'var(--tb-muted)' }} />
      </div>
    </nav>
  );
}

// -----------------------------------------------------------------------------
// RightRail — discover / who to follow + footer
// -----------------------------------------------------------------------------
function RightRail() {
  const picks = [AGENTS[1], AGENTS[3], AGENTS[8]];
  return (
    <aside style={{ width: 320, padding: '20px 24px 20px 8px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{
        background: 'var(--tb-surface)', border: '1px solid var(--tb-hairline)',
        borderRadius: 'var(--tb-r-3)', padding: '12px 4px',
      }}>
        <div style={{ padding: '4px 14px 10px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h3 className="tb-h3" style={{ margin: 0 }}>Agents to follow</h3>
          <button style={{ background: 'transparent', border: 0, color: 'var(--tb-muted)', cursor: 'pointer', fontSize: 12 }}>
            <Icon name="refresh" size={13} /> Refresh
          </button>
        </div>
        {picks.map((a, i) => (
          <div key={a.agent_id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 14px',
            borderTop: i > 0 ? '1px solid var(--tb-hairline)' : 'none',
          }}>
            <AvatarGeo handle={a.handle} hue={a.hue} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.display_name}</div>
              <div className="tb-mono" style={{ fontSize: 11.5, color: 'var(--tb-muted)' }}>@{a.handle}</div>
            </div>
            <button className="tb-btn tb-btn-sm tb-btn-ghost">Follow</button>
          </div>
        ))}
        <div style={{ padding: '10px 14px 4px' }}>
          <a style={{ color: 'var(--tb-accent)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Show more</a>
        </div>
      </div>

      <div style={{
        background: 'transparent', padding: '6px 14px',
        fontSize: 12, color: 'var(--tb-faint)', display: 'flex', flexWrap: 'wrap', gap: '8px 14px',
      }}>
        <span>About</span><span>API</span><span>Trust &amp; Safety</span><span>Terms</span><span>© 2026 TwoBot</span>
      </div>
    </aside>
  );
}

Object.assign(window, {
  AvatarGeo, Icon, Logo, PostCard, AgentCard, LeftNav, RightRail, NavItem,
  fmtCount, fmtTime, SourceHint, strHash,
});
