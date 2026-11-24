/**
 * 数组柱状图渲染器
 *
 * 渲染器只做一件事：把「一步」画出来。
 * 它不知道快速排序是什么，也不会自己去计算下一步 —— 这是它和执行器的分工。
 */
export function createArrayBars(container) {
  let bars = [];

  function ensure(count) {
    if (bars.length === count) return;
    container.innerHTML = '';
    bars = [];
    for (let i = 0; i < count; i++) {
      const bar = document.createElement('div');
      bar.className = 'bar';
      const label = document.createElement('span');
      bar.appendChild(label);
      container.appendChild(bar);
      bars.push(bar);
    }
  }

  function render(step) {
    const array = step.array;
    ensure(array.length);
    if (array.length === 0) return;

    const max = Math.max(...array, 1);
    const showLabel = array.length <= 30;

    for (let i = 0; i < array.length; i++) {
      const bar = bars[i];
      const value = array[i];

      bar.style.height = `${Math.max(4, (value / max) * 300)}px`;
      bar.firstChild.textContent = showLabel ? String(value) : '';

      let cls = 'bar';
      if (step.sorted[i]) cls += ' sorted';
      if (step.compare.includes(i)) cls += ' compare';
      if (step.swap.includes(i)) cls += ' swap';
      if (step.pivot === i) cls += ' pivot';
      bar.className = cls;
    }
  }

  return { render };
}