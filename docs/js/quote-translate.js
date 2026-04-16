document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('blockquote').forEach(function (el) {
    const ps = el.querySelectorAll('p[data-cn]');
    if (!ps.length) return;

    const originals = Array.from(ps).map(p => p.textContent);
    const translations = Array.from(ps).map(p => p.getAttribute('data-cn'));
    let showing = 'orig';

    function swap(to) {
      ps.forEach((p, i) => {
        p.textContent = to === 'cn' ? translations[i] : originals[i];
      });
      showing = to;
    }

    el.style.cursor = 'pointer';
    el.addEventListener('mouseenter', () => swap('cn'));
    el.addEventListener('mouseleave', () => swap('orig'));
    el.addEventListener('click', () => swap(showing === 'orig' ? 'cn' : 'orig'));
  });
});
