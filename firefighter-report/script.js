// script.js - Shared logic for CFD Report PWA

const APP_VERSION = "20260105.2"; // ← Must match sw.js CACHE_NAME

// Cache busting on version change
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistration().then(reg => {
    if (reg) {
      fetch('version.json?t=' + Date.now())
        .then(r => r.json())
        .then(data => {
          if (data.version !== APP_VERSION) {
            caches.keys().then(names => {
              names.forEach(name => caches.delete(name));
            });
            reg.unregister().then(() => window.location.reload(true));
          }
        })
        .catch(() => {});
    }
  });
}

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('Service Worker registered:', reg))
      .catch(err => console.error('SW registration failed:', err));
  });
}

// Save and navigate (used on all pages)
function saveAndGo(nextPage) {
  const form = document.getElementById('pageForm');
  if (form && !form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const data = {};
  const elements = document.querySelectorAll('#pageForm input, #pageForm select, #pageForm textarea');
  elements.forEach(el => {
    if (el.type === 'checkbox') {
      if (el.checked) {
        if (!data[el.name]) data[el.name] = [];
        data[el.name].push(el.value);
      }
    } else if (el.value !== '') {
      data[el.name] = el.value;
    }
  });

  const existing = JSON.parse(localStorage.getItem('reportData') || '{}');
  localStorage.setItem('reportData', JSON.stringify({ ...existing, ...data }));

  window.location.href = nextPage;
}

// Load saved data (used on all pages)
function loadData() {
  const data = JSON.parse(localStorage.getItem('reportData') || '{}');
  Object.keys(data).forEach(key => {
    const elements = document.querySelectorAll(`[name="${key}"]`);
    elements.forEach(el => {
      if (el.type === 'checkbox') {
        el.checked = data[key] && data[key].includes(el.value);
      } else {
        el.value = data[key] || '';
      }
    });
  });
}

// Clear data after successful submit (used on page7)
function clearReportData() {
  localStorage.removeItem('reportData');
}
