/**
 * 播放器：只负责“第几步”，不负责算法也不负责画。
 *
 * 用到的三个概念，前端天天见：
 *  - 状态：index / playing
 *  - 状态变化后通知外部：onStep、onState
 *  - 定时器：setInterval
 */
export class Player {
  constructor({ onStep, onState }) {
    this.steps = [];
    this.index = 0;
    this.playing = false;
    this.timer = null;
    this.speed = 6; // 1（慢）~ 10（快）
    this.onStep = onStep || (() => {});
    this.onState = onState || (() => {});
  }

  load(steps) {
    this.pause();
    this.steps = steps;
    this.index = 0;
    this.emitStep();
    this.emitState();
  }

  get total() {
    return this.steps.length;
  }

  get atEnd() {
    return this.index >= this.steps.length - 1;
  }

  current() {
    return this.steps[this.index];
  }

  next() {
    if (this.atEnd) return false;
    this.index++;
    this.emitStep();
    this.emitState();
    return true;
  }

  prev() {
    if (this.index <= 0) return false;
    this.index--;
    this.emitStep();
    this.emitState();
    return true;
  }

  seek(index) {
    const clamped = Math.max(0, Math.min(this.steps.length - 1, Number(index) || 0));
    this.index = clamped;
    this.emitStep();
    this.emitState();
  }

  play() {
    if (this.playing || this.steps.length === 0) return;
    if (this.atEnd) this.seek(0);

    this.playing = true;
    this.timer = setInterval(() => {
      if (!this.next()) this.pause();
    }, this.delay());
    this.emitState();
  }

  pause() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
    this.emitState();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  setSpeed(value) {
    this.speed = Math.max(1, Math.min(10, Number(value) || 6));
    if (this.playing) {
      this.pause();
      this.play();
    }
  }

  delay() {
    // 速度 10 → 60ms 一步；速度 1 → 780ms 一步
    return 840 - this.speed * 78;
  }

  emitStep() {
    if (this.steps.length === 0) return;
    this.onStep(this.steps[this.index], this.index);
  }

  emitState() {
    this.onState({
      index: this.index,
      total: this.steps.length,
      playing: this.playing,
      atEnd: this.atEnd
    });
  }
}