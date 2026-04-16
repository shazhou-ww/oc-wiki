document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('blockquote[data-cn]').forEach(function (el) {
    const cn = el.getAttribute('data-cn').split('|');
    // 收集所有文本节点
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    // 存原文
    const orig = nodes.map(n => n.textContent);
    let showing = 'orig';

    function swap(to) {
      if (to === 'cn') {
        cn.forEach((text, i) => { if (nodes[i]) nodes[i].textContent = text; });
      } else {
        orig.forEach((text, i) => { if (nodes[i]) nodes[i].textContent = text; });
      }
      showing = to;
    }

    el.style.cursor = 'pointer';
    el.addEventListener('mouseenter', () => swap('cn'));
    el.addEventListener('mouseleave', () => swap('orig'));
    el.addEventListener('click', () => swap(showing === 'orig' ? 'cn' : 'orig'));
  });
});
