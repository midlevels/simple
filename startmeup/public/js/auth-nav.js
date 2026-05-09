/**
 * auth-nav.js
 *
 * Checks whether the current visitor is signed in by calling the
 * /auth/check-auth.php endpoint, then updates the header accordingly:
 *
 *   • Logged-out  → shows a plain "Login" link
 *   • Logged-in   → hides the Login link and shows a user-icon button
 *                   with a one-item dropdown ("Sign out")
 */
(function () {
  'use strict';

  const loginLink  = document.getElementById('auth-login-link');
  const userMenu   = document.getElementById('auth-user-menu');
  const userBtn    = document.getElementById('auth-user-btn');
  const dropdown   = document.getElementById('auth-dropdown');
  const screenName = document.getElementById('auth-screen-name');
  const csrfInput  = document.getElementById('auth-logout-csrf');

  if (!loginLink || !userMenu) return;

  // ── Auth-state check ───────────────────────────────────────────────────────

  fetch('/auth/check-auth.php', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.logged_in) return;

      // Hide the static Login link
      loginLink.hidden = true;

      // Populate and reveal the user menu
      if (screenName) screenName.textContent = data.screen_name || '';
      if (csrfInput)  csrfInput.value        = data.csrf_token  || '';
      userMenu.hidden = false;
    })
    .catch(function () {
      // Network error or PHP not available — leave the default Login link visible
    });

  // ── Dropdown toggle ────────────────────────────────────────────────────────

  if (userBtn && dropdown) {
    userBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var wasOpen = !dropdown.hidden;
      dropdown.hidden = wasOpen;
      userBtn.setAttribute('aria-expanded', String(!wasOpen));
    });

    // Close when clicking anywhere outside the menu
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.auth-user-menu')) {
        dropdown.hidden = true;
        userBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !dropdown.hidden) {
        dropdown.hidden = true;
        userBtn.setAttribute('aria-expanded', 'false');
        userBtn.focus();
      }
    });
  }
}());
