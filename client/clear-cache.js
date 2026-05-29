// Clear all cached data when auth fails
if ('caches' in window) {
  caches.keys().then(names => {
    names.forEach(name => {
      caches.delete(name);
    });
  });
}

// Clear local storage
localStorage.clear();

// Clear session storage
sessionStorage.clear();

console.log('Browser cache cleared');