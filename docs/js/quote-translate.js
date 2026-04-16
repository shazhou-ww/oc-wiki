document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('blockquote[data-cn]').forEach(function (el) {
    const orig = el.getAttribute('data-orig');
    const cn = el.getAttribute('data-cn');
    let showing = 'orig';

    function swap(to) {
      const text = to === 'cn' ? cn : orig;
      // 清空并重建文本内容，保留换行
      el.innerHTML = text.split('&#10;').join('\n')
        .split('\n').map((line, i, arr) => {
          if (i === arr.length - 1 && line === '') return '';
          return line;
        }).join('<br>');
      showing = to;
    }

    el.style.cursor = 'pointer';
    el.addEventListener('mouseenter', () => swap('cn'));
    el.addEventListener('mouseleave', () => swap('orig'));
    el.addEventListener('click', (e) => {
      e.preventDefault();
      swap(showing === 'orig' ? 'cn' : 'orig');
    });
  });
});
