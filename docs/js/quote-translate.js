document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('blockquote[data-cn]').forEach(function (el) {
    const cn = el.getAttribute('data-cn');
    // 找第一个文本节点（引言正文），存原文
    const textNode = Array.from(el.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (!textNode) return;
    const original = textNode.textContent;
    let showing = 'orig';

    function swap(to) {
      textNode.textContent = to === 'cn' ? cn + '\n' : original;
      showing = to;
    }

    el.addEventListener('mouseenter', () => swap('cn'));
    el.addEventListener('mouseleave', () => swap('orig'));
    el.addEventListener('click', (e) => {
      e.preventDefault();
      swap(showing === 'orig' ? 'cn' : 'orig');
    });
  });
});
