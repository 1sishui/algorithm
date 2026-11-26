// 逻辑自测：报告有没有内容、渲染是否安全
// 「模型返回空壳 JSON」是真实发生过的情况：字段都在、内容全空，
// 直接渲染就是一块空白，用户只看到「分析完成」。这里把判定钉住。
import assert from 'node:assert/strict';
import { hasReportContent, renderReport } from '../src/agent/report.js';

assert.equal(hasReportContent(null), false);
assert.equal(hasReportContent(undefined), false);
assert.equal(hasReportContent('字符串'), false);
assert.equal(hasReportContent({}), false);
assert.equal(
  hasReportContent({ summary: '   ', strengths: [], weaknesses: [], suggestions: [], correctionProfile: ' ' }),
  false,
  '空壳报告不能算有内容'
);
assert.equal(hasReportContent({ summary: '整体还行' }), true);
assert.equal(hasReportContent({ strengths: ['模拟'] }), true);
assert.equal(hasReportContent({ weaknesses: ['图论'] }), true);
assert.equal(hasReportContent({ suggestions: ['刷 DP'] }), true);
assert.equal(hasReportContent({ correctionProfile: '习惯整段重写' }), true);

const container = { innerHTML: '' };
renderReport(container, {
  summary: 'a<b',
  strengths: ['优势一'],
  weaknesses: [],
  suggestions: ['建议一']
});
assert.match(container.innerHTML, /a&lt;b/, '报告里的尖括号要转义');
assert.match(container.innerHTML, /优势一/);
assert.match(container.innerHTML, /建议一/);
assert.doesNotMatch(container.innerHTML, /短板/, '没有短板就不渲染这一块');

renderReport(container, {});
assert.equal(container.innerHTML.trim(), '', '空报告不该渲染出任何东西');

console.log('report 自测通过 ✓');