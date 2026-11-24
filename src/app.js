/**
 * 应用入口：把「知识图谱 → 算法执行器 → 渲染器 → 播放器 → 诊断/评估」串起来。
 *
 * 这个文件只做装配，不写算法、不画图、不拼提示词。
 * 想加功能时，先想清楚该改哪个模块，再动手。
 */
import { algorithms, findAlgorithm, findByKnowledgePoint } from './algorithms/registry.js';
import { createArrayBars } from './render/arrayBars.js';
import { Player } from './core/player.js';
import { categories, nodeById, recommend } from './knowledge/graph.js';
import { diagnose } from './diagnosis/rules.js';
import { diagnoseWithLLM, checkHealth, explainFailure } from './llm/client.js';
import { createDiagnosisView } from './ui/diagnosisPanel.js';
import { createMastery } from './ui/mastery.js';

const $ = (id) => document.getElementById(id);

const el = {
  select: $('algo-select'),
  input: $('input-data'),
  regenerate: $('btn-regenerate'),
  bars: $('bars'),
  prev: $('btn-prev'),
  play: $('btn-play'),
  next: $('btn-next'),
  progress: $('progress'),
  stepText: $('step-text'),
  speed: $('speed'),
  note: $('note'),
  compare: $('m-compare'),
  swap: $('m-swap'),
  depth: $('m-depth'),
  index: $('m-index'),
  kg: $('kg'),
  mastery: $('mastery'),
  recommend: $('recommend'),
  code: $('code-input'),
  diagnoseBtn: $('btn-diagnose'),
  diagnosis: $('diagnosis'),
  healthBtn: $('btn-health'),
  health: $('health'),
  progressText: $('progress-text')
};

const renderer = createArrayBars(el.bars);
const mastery = createMastery(el.mastery);

let currentAlgo = algorithms[0];

const player = new Player({
  onStep: (step, index) => {
    renderer.render(step);
    el.note.textContent = step.note;
    el.compare.textContent = step.metrics.comparisons;
    el.swap.textContent = step.metrics.swaps;
    el.depth.textContent = step.depth;
    el.index.textContent = index;
    el.progress.value = String(index);
    el.stepText.textContent = `${index + 1} / ${player.total}`;
  },
  onState: (st) => {
    el.play.textContent = st.playing ? '暂停' : '播放';
    el.prev.disabled = st.index <= 0;
    el.next.disabled = st.total === 0 || st.index >= st.total - 1;
    el.progress.max = String(Math.max(0, st.total - 1));
    el.progressText.textContent = st.total === 0 ? '未开始' : `${st.index + 1} / ${st.total} 步`;
  }
});

/* ---------------- 输入与生成 ---------------- */

function parseInput(text) {
  const nums = String(text)
    .split(/[,\s，、]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));

  if (nums.length === 0) return [5, 2, 9, 1, 7, 3, 8];
  return nums.slice(0, 60).map((n) => Math.round(n));
}

function build() {
  const input = parseInput(el.input.value);
  const steps = currentAlgo.run(input);
  player.load(steps);
  el.speed.value = String(player.speed);
}

/* ---------------- 算法下拉框 ---------------- */

algorithms.forEach((algo) => {
  const option = document.createElement('option');
  option.value = algo.id;
  option.textContent = `${algo.name}（${algo.brief}）`;
  el.select.appendChild(option);
});
el.select.value = currentAlgo.id;

el.select.addEventListener('change', () => {
  currentAlgo = findAlgorithm(el.select.value);
  build();
  markActiveKnowledgePoint();
});

/* ---------------- 知识图谱侧边栏 ---------------- */

function renderKnowledgeGraph() {
  el.kg.innerHTML = '';
  categories.forEach((cat) => {
    const group = document.createElement('div');
    group.className = 'kg-group';

    const title = document.createElement('div');
    title.className = 'kg-cat';
    title.textContent = cat.name;
    group.appendChild(title);

    cat.nodes.forEach((node) => {
      const btn = document.createElement('button');
      btn.className = 'kg-node';
      btn.dataset.id = node.id;
      btn.innerHTML = `<span class="dot"></span><span>${node.name}</span><span class="pct">${node.mastery}</span>`;
      btn.addEventListener('click', () => onKnowledgePointClick(node));
      group.appendChild(btn);
    });

    el.kg.appendChild(group);
  });
  markActiveKnowledgePoint();
}

function markActiveKnowledgePoint() {
  el.kg.querySelectorAll('.kg-node').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.id === currentAlgo.kp);
    const node = nodeById.get(btn.dataset.id);
    btn.classList.toggle('done', Boolean(node && node.mastery >= 80));
  });
}

function onKnowledgePointClick(node) {
  const algo = findByKnowledgePoint(node.id);
  if (algo) {
    currentAlgo = algo;
    el.select.value = algo.id;
    build();
    markActiveKnowledgePoint();
    return;
  }
  el.note.textContent = `「${node.name}」的可视化模板正在建设中（计划第 2 阶段交付），当前先跑通排序类算法。`;
}

/* ---------------- 推荐 ---------------- */

function renderRecommend() {
  const { node, why } = recommend();
  el.recommend.innerHTML = `<div class="kp">${node.name}</div><div class="why">${node.category} · ${why}</div>`;
}

/* ---------------- 诊断 ---------------- */

const diagnosisView = createDiagnosisView(el.diagnosis);

async function runDiagnosis() {
  const code = el.code.value;
  if (!code.trim()) {
    diagnosisView.error('先把代码粘进上面的输入框。');
    return;
  }

  el.diagnoseBtn.disabled = true;
  diagnosisView.loading();

  try {
    const llm = await diagnoseWithLLM({
      code,
      algorithm: currentAlgo.name,
      language: 'C++'
    });

    if (llm.ok) {
      diagnosisView.show({ result: llm.result, source: 'llm', meta: llm.meta });
    } else {
      // 关键降级路径：模型不可用时，本地规则接管，界面照常给出结论
      diagnosisView.show({
        result: diagnose(code),
        source: 'rules',
        fallback: llm
      });
    }
  } finally {
    el.diagnoseBtn.disabled = false;
  }
}

el.diagnoseBtn.addEventListener('click', runDiagnosis);

el.healthBtn.addEventListener('click', async () => {
  el.health.textContent = '正在测试连接…';
  const health = await checkHealth(true);

  if (!health.ok) {
    el.health.className = 'health bad';
    el.health.textContent = `连接失败：${explainFailure(health)}`;
    return;
  }

  const d = health.data;
  el.health.className = d.key_configured && !String(d.probe || '').startsWith('失败') ? 'health good' : 'health bad';
  el.health.innerHTML = [
    `服务 v${d.version} · 模型 ${d.model}`,
    `Key：${d.key_configured ? d.key_masked : '未配置'}`,
    `.env：${d.env_found ? '已找到' : '未找到'}`,
    d.probe ? `连接测试：${d.probe}` : ''
  ].filter(Boolean).join('<br>');
});

/* ---------------- 事件绑定 ---------------- */

el.regenerate.addEventListener('click', build);
el.prev.addEventListener('click', () => player.prev());
el.next.addEventListener('click', () => player.next());
el.play.addEventListener('click', () => player.toggle());
el.speed.addEventListener('input', () => player.setSpeed(el.speed.value));
el.progress.addEventListener('input', () => {
  player.pause();
  player.seek(el.progress.value);
});

document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.code === 'Space') {
    event.preventDefault();
    player.toggle();
  }
  if (event.code === 'ArrowRight') player.next();
  if (event.code === 'ArrowLeft') player.prev();
});

/* ---------------- 结束时的“成长”反馈（演示） ---------------- */

let lastEndIndex = -1;
setInterval(() => {
  if (player.atEnd && player.total > 0 && lastEndIndex !== player.index) {
    lastEndIndex = player.index;
    mastery.bump('fix', 1);
    mastery.bump('coverage', 1);
    const node = nodeById.get(currentAlgo.kp);
    if (node) node.mastery = Math.min(100, node.mastery + 2);
    markActiveKnowledgePoint();
    renderRecommend();
  }
}, 600);

/* ---------------- 启动 ---------------- */

renderKnowledgeGraph();
renderRecommend();
build();
diagnosisView.show({
  result: diagnose('int a[10]; for (int i = 0; i <= n; i++) { a[i] = 0; }'),
  source: 'rules'
});