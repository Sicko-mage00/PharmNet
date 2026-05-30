// ─── Helpers ──────────────────────────────────────────
const getToken = () => localStorage.getItem('token');
const getUser  = () => {
  const u = localStorage.getItem('user');
  return u ? JSON.parse(u) : null;
};

// ─── Password toggle ──────────────────────────────────
const togglePassword = (toggleId, inputId) => {
  const toggle = document.getElementById(toggleId);
  const input  = document.getElementById(inputId);
  if (!toggle || !input) return;

  const eyeOpen   = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const eyeClosed = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

  toggle.addEventListener('click', () => {
    if (input.type === 'password') {
      input.type = 'text';
      toggle.innerHTML = eyeClosed;
    } else {
      input.type = 'password';
      toggle.innerHTML = eyeOpen;
    }
  });
};

// ─── Loading helper ───────────────────────────────────
const showLoader = (containerId) => {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `<div class="loader"><div class="spinner"></div> Loading...</div>`;
};

const showEmpty = (containerId, message = 'No data found') => {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `<div class="empty-state"><p>${message}</p></div>`;
};

// ─── DOM ready ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // populate topbar with user info
  const user = getUser();
  if (user) {
    const nameEl     = document.getElementById('user-name');
    const roleEl     = document.getElementById('user-role');
    const avatarEl   = document.getElementById('user-avatar');
    const facilityEl = document.getElementById('topbar-facility');

    if (nameEl)     nameEl.textContent     = user.name || 'User';
    if (roleEl)     roleEl.textContent     = user.role || '—';
    if (avatarEl)   avatarEl.textContent   = (user.name || 'U')[0].toUpperCase();
    if (facilityEl) facilityEl.textContent = user.facility || '—';
  }

  // highlight active nav item
  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav-item').forEach(item => {
    const href = item.getAttribute('href');
    if (href && href !== '#' && currentPath.startsWith(href) && href !== '/') {
      item.classList.add('active');
    }
  });

  // sidebar toggle for mobile
  const toggleBtn = document.getElementById('sidebar-toggle');
  const sidebar   = document.querySelector('.sidebar');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }

  // logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await fetch('/api/auth/logout', { method: 'POST' });
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    });
  }

  // load alert count badge
  const token = getToken();
  if (token) {
    fetch('/api/alerts', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(r => r.json())
    .then(data => {
      const count = (data.alerts || []).filter(a => a.status === 'pending').length;
      const badge = document.getElementById('alert-count');
      if (badge && count > 0) {
        badge.textContent = count;
        badge.classList.add('visible');
      }
    })
    .catch(() => {});
  }

  // auth guard
  const protectedPages = ['/dashboard', '/inventory', '/sales', '/alerts', '/profile', '/verify', '/facilities', '/keys'];
  if (protectedPages.some(p => currentPath.startsWith(p))) {
    if (!getToken()) {
      window.location.href = '/login';
    }
  }

});