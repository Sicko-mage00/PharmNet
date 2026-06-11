// ─── Helpers ──────────────────────────────────────────
const getUser = () => {
  const u = localStorage.getItem('user');
  return u ? JSON.parse(u) : null;
};

const setUser = (data) => {
  localStorage.setItem('user', JSON.stringify(data));
};

// ─── Title-case helper ────────────────────────────────
const toTitleCase = (str) =>
  (str || '').replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

// ─── Password toggle ──────────────────────────────────
const togglePassword = (toggleId, inputId) => {
  const toggle = document.getElementById(toggleId);
  const input  = document.getElementById(inputId);
  if (!toggle || !input) return;
  const eyeOpen   = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const eyeClosed = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  toggle.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
    toggle.innerHTML = input.type === 'password' ? eyeOpen : eyeClosed;
  });
};

// ─── Loading helpers ──────────────────────────────────
const showLoader = (id) => {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="loader"><div class="spinner"></div> Loading...</div>`;
};

const showEmpty = (id, msg = 'No data found') => {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="empty-state"><p>${msg}</p></div>`;
};

// ─── Count up animation ───────────────────────────────
const countUp = (el, target, duration = 800) => {
  if (!el) return;
  const start = performance.now();
  const run = (now) => {
    const p = Math.min((now - start) / duration, 1);
    el.textContent = Math.floor((1 - Math.pow(1 - p, 3)) * target);
    if (p < 1) requestAnimationFrame(run);
    else el.textContent = target;
  };
  requestAnimationFrame(run);
};

// ─── DOM ready ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  const currentPath = window.location.pathname;

  // ── Auth guard — fetch fresh profile from server ──
  // This is the single source of truth; we do NOT trust localStorage for role checks
  const adminPaths    = ['/admin'];
  const protectedPaths = ['/dashboard','/inventory','/sales','/alerts','/profile','/verify','/scan'];
  const isAdminPath    = adminPaths.some(p => currentPath.startsWith(p));
  const isProtected    = protectedPaths.some(p => currentPath.startsWith(p));

  if (isAdminPath || isProtected) {
    fetch('/api/auth/profile', { credentials: 'include' })
      .then(r => {
        if (!r.ok) {
          window.location.href = '/login';
          return null;
        }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        const serverUser = data.user;

        // If a normal user somehow hits an admin page, boot them
        if (isAdminPath && serverUser.role !== 'super_admin') {
          window.location.href = '/dashboard';
          return;
        }
        // If admin hits a normal protected page, redirect to admin
        if (!isAdminPath && serverUser.role === 'super_admin') {
          window.location.href = '/admin';
          return;
        }

        // Sync localStorage with fresh server data so topbar is always accurate
        const fullName = toTitleCase(`${serverUser.firstName} ${serverUser.lastName}`);
        const stored = {
          name:       fullName,
          role:       serverUser.role,
          email:      serverUser.email,
          facility:   serverUser.facility_id ? serverUser.facility_id.name : null,
          facilityId: serverUser.facility_id ? serverUser.facility_id._id  : null,
        };
        setUser(stored);
        initTopbar(stored);
      })
      .catch(() => window.location.href = '/login');
  } else {
    // Public page — still init topbar from cache if available
    const cached = getUser();
    if (cached) initTopbar(cached);
  }

  // ── Topbar initialiser ────────────────────────────
  function initTopbar(user) {
    const nameEl         = document.getElementById('user-name');
    const roleEl         = document.getElementById('user-role');
    const avatarEl       = document.getElementById('user-avatar');
    const facilityNameEl = document.getElementById('topbar-facility-name');

    if (nameEl)         nameEl.textContent = toTitleCase(user.name || 'User');
    if (roleEl)         roleEl.textContent = (user.role || '').replace(/_/g, ' ').toUpperCase();
    if (facilityNameEl && user.facility) facilityNameEl.textContent = user.facility;

    // Profile photo — stored per-user by email key
    const photoKey   = `profile_photo_${user.email || 'default'}`;
    const savedPhoto = localStorage.getItem(photoKey);
    if (avatarEl) {
      if (savedPhoto) {
        avatarEl.innerHTML = `<img src="${savedPhoto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
      } else {
        avatarEl.textContent = (user.name || 'U')[0].toUpperCase();
      }
    }
  }

  // ── Active nav — no full-page reload on same section ──
  document.querySelectorAll('.nav-item').forEach(item => {
    const href = item.getAttribute('href');
    if (!href || href === '#') return;

    // Mark active
    if (currentPath.startsWith(href) && href !== '/') {
      item.classList.add('active');
    }

    // Prevent reload when clicking the already-active link
    item.addEventListener('click', (e) => {
      if (currentPath === href || (href !== '/' && currentPath.startsWith(href) && item.classList.contains('active'))) {
        e.preventDefault();
      }
    });
  });

  // ── Sidebar toggle ────────────────────────────────
  const toggleBtn = document.getElementById('sidebar-toggle');
  const sidebar   = document.getElementById('sidebar');
  let overlay     = document.getElementById('sidebar-overlay');

  if (!overlay) {
    overlay           = document.createElement('div');
    overlay.id        = 'sidebar-overlay';
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
  }

  const openSidebar  = () => { sidebar?.classList.add('open');    overlay.classList.add('visible');    };
  const closeSidebar = () => { sidebar?.classList.remove('open'); overlay.classList.remove('visible'); };

  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    sidebar?.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  overlay.addEventListener('click', closeSidebar);

  // Close sidebar when any nav-item is clicked on mobile
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth < 768) closeSidebar();
    });
  });

  // ── Logout ────────────────────────────────────────
  document.getElementById('logout-btn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    localStorage.removeItem('user');
    localStorage.removeItem('last_alert_count');
    window.location.href = '/login';
  });

  // ── Alerts bell — only for non-admin ─────────────
  const user = getUser();
  if (user && user.role !== 'super_admin') {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    let lastAlertCount = parseInt(localStorage.getItem('last_alert_count') || '0');

    const checkAlerts = () => {
      fetch('/api/alerts', { credentials: 'include' })
        .then(r => { if (!r.ok) return null; return r.json(); })
        .then(data => {
          if (!data) return;
          const pending = (data.alerts || []).filter(a => a.status === 'pending');
          const count   = pending.length;

          const badge = document.getElementById('alert-count');
          const bell  = document.getElementById('topbar-alert-btn');
          const dot   = document.getElementById('topbar-alert-dot');

          if (badge) {
            badge.textContent = count > 0 ? count : '';
            badge.classList.toggle('visible', count > 0);
          }
          if (bell && dot) {
            bell.classList.toggle('has-alerts', count > 0);
            dot.classList.toggle('visible',     count > 0);
            dot.classList.toggle('pulse',        count > 0);
          }

          if (count > lastAlertCount && Notification.permission === 'granted' && pending[0]) {
            new Notification('PharmaNet Alert', {
              body: `${pending[0].type} Alert — ${pending[0].drug_name}. Action required.`,
              icon: '/favicon.ico',
            });
          }

          lastAlertCount = count;
          localStorage.setItem('last_alert_count', count);
        })
        .catch(() => {});
    };

    checkAlerts();
    setInterval(checkAlerts, 30000);

    // ── Socket.io ──────────────────────────────────
    if (user?.facilityId) {
      const s    = document.createElement('script');
      s.src      = '/socket.io/socket.io.js';
      s.onload   = () => {
        const socket = io({ withCredentials: true });
        socket.emit('join_facility', user.facilityId);

        socket.on('new_alert', (data) => {
          if (Notification.permission === 'granted') {
            new Notification('PharmaNet — New Alert', { body: data.message, icon: '/favicon.ico' });
          }
          document.getElementById('topbar-alert-btn')?.classList.add('has-alerts');
          document.getElementById('topbar-alert-dot')?.classList.add('visible', 'pulse');
          checkAlerts();
          if (currentPath === '/alerts') setTimeout(() => window.location.reload(), 800);
        });

        socket.on('alert_cancelled', () => {
          checkAlerts();
          if (currentPath === '/alerts') setTimeout(() => window.location.reload(), 800);
        });

        socket.on('drugs_dispatched', (data) => {
          if (Notification.permission === 'granted') {
            new Notification('PharmaNet — Dispatched', { body: data.message, icon: '/favicon.ico' });
          }
          checkAlerts();
        });
      };
      document.head.appendChild(s);
    }
  }

});
