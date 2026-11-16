import { createApp } from 'vue';
import vehicleCatalog from '../vehicle-catalog.js';
import '../styles.css';

window.TallerVehicleCatalog = vehicleCatalog;

/**
 * Keep Vue's mount point isolated from the existing screens. The current
 * application still initializes its legacy DOM handlers in app.js; mounting
 * Vue directly on #app would replace that markup before those handlers run.
 */
const app = createApp({
  render: () => null,
  async mounted() {
    try {
      const response = await fetch('/api/mode');
      const mode = await response.json();
      if (mode.demo) {
        const badge = document.querySelector('#demo-mode-banner');
        badge.hidden = false;
        badge.textContent = mode.mensaje;
      }
    } catch {
      // The current MySQL service does not expose the DEMO mode endpoint.
    }
    await import('../app.js');
  },
});

app.mount('#vue-runtime');
