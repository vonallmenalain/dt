(function (window) {
    'use strict';

    function createApiKeySessionStore(storageKey, options = {}) {
        const storage = window.sessionStorage;
        const key = String(storageKey || '').trim();
        const logger = typeof options.logger === 'function' ? options.logger : null;

        function log(message, type) {
            if (logger) logger(message, type);
        }

        function load() {
            if (!key) return '';
            try {
                return storage.getItem(key) || '';
            } catch (err) {
                return '';
            }
        }

        function save(value) {
            if (!key) return false;
            const apiKey = String(value || '').trim();
            if (!apiKey) return false;

            try {
                storage.setItem(key, apiKey);
                return true;
            } catch (err) {
                return false;
            }
        }

        function clear() {
            if (!key) return false;
            try {
                storage.removeItem(key);
                return true;
            } catch (err) {
                return false;
            }
        }

        function hydrateInput(inputEl) {
            const saved = load();
            if (!saved || !inputEl) return false;
            inputEl.value = saved;
            log('🔐 Session-API-Key wurde automatisch geladen.', 'log-success');
            return true;
        }

        return {
            load,
            save,
            clear,
            hydrateInput
        };
    }

    window.AdminApiKeyStorage = {
        createApiKeySessionStore
    };
})(window);
