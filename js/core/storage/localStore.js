let storageRevision = 0;
const revisions = new Map();
let clearRevision = 0;
export const LocalStore = {
  revision(key) {
    return revisions.get(key) || clearRevision;
  },
  get(key, defaultValue = null) {
    try {
      const value = localStorage.getItem(key);
      return value !== null ? JSON.parse(value) : defaultValue;
    } catch (e) {
      console.error("LocalStore get error:", e);
      return defaultValue;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      revisions.set(key, ++storageRevision);
    } catch (e) {
      console.error("LocalStore set error:", e);
    }
  },

  remove(key) {
    localStorage.removeItem(key);
    revisions.set(key, ++storageRevision);
  },

  clear() {
    localStorage.clear();
    revisions.clear();
    clearRevision = ++storageRevision;
  }
};
