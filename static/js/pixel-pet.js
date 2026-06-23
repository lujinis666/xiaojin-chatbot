// ===== Pixel Pet Engine =====
// 一个用 Canvas 逐像素绘制的可交互动画小人
(function () {
    'use strict';

    const S = 4;          // 每个像素点放大 4 倍
    const PW = 50;        // 画布像素宽（pixel-art 坐标）
    const PH = 38;        // 画布像素高
    const CW = PW * S;    // 实际画布 200px
    const CH = PH * S;    // 实际画布 152px

    // 调色板 - 匹配用户头像风格（黑发灰卫衣少年）
    const P = {
        hair:    '#1a1a2e',
        hairH:   '#2d2d44',
        skin:    '#fdd9b5',
        skinS:   '#e0b89a',
        eyeW:    '#ffffff',
        eye:     '#1a1a2e',
        eyeH:    '#ffffff',   // 眼睛高光
        blush:   '#ff9999',
        mouth:   '#c0605a',
        mouthO:  '#e87461',
        hoodie:  '#7a8090',
        hoodieD: '#5e6470',
        hoodieL: '#949cac',
        pocket:  '#6a7080',
        pants:   '#2a2a3e',
        shoes:   '#1a1a2e',
        hand:    '#f0c090',
        shadow:  'rgba(0,0,0,0.08)',
    };

    class PixelPet {
        constructor(id) {
            this.cvs = document.getElementById(id);
            if (!this.cvs) return;
            this.ctx = this.cvs.getContext('2d');
            this.cvs.width = CW;
            this.cvs.height = CH;

            // 角色位置（pixel-art 坐标）
            this.x = PW / 2;
            this.groundY = PH - 4;

            // 状态机
            this.state = 'idle';
            this.frame = 0;
            this.timer = 0;

            // 动画偏移（pixel-art 坐标，允许小数实现亚像素平滑）
            this.bobY = 0;
            this.lLegY = 0;
            this.rLegY = 0;
            this.lArmY = 0;
            this.rArmY = 0;
            this.mouthOpen = false;
            this.walkDir = 1;

            // 眨眼系统
            this.blinkCD = 80 + Math.random() * 100;
            this.blinkFrames = 0;
            this.blink = false;

            // 事件
            this.cvs.style.cursor = 'pointer';
            this.cvs.addEventListener('click', () => this.onClick());

            // 启动
            this.run();
            this.autoAct();
        }

        // 在 pixel-art 坐标 (x,y) 绘制 w×h 的矩形
        px(x, y, w, h, c) {
            this.ctx.fillStyle = c;
            this.ctx.fillRect(
                Math.round(x * S),
                Math.round(y * S),
                Math.round(w * S),
                Math.round(h * S)
            );
        }

        draw() {
            const cx = this.x;
            const gy = this.groundY + this.bobY;

            // ── 影子 ──
            this.ctx.fillStyle = P.shadow;
            this.ctx.beginPath();
            this.ctx.ellipse(
                cx * S, (this.groundY + 1.5) * S,
                6 * S, 1.2 * S, 0, 0, Math.PI * 2
            );
            this.ctx.fill();

            // ── 左腿 + 左鞋（加长腿型） ──
            const lly = this.lLegY;
            this.px(cx - 2, gy - 7 + lly, 2, 5, P.pants);
            this.px(cx - 3, gy - 2 + lly, 3, 1, P.shoes);

            // ── 右腿 + 右鞋 ──
            const rly = this.rLegY;
            this.px(cx + 1, gy - 7 + rly, 2, 5, P.pants);
            this.px(cx + 1, gy - 2 + rly, 3, 1, P.shoes);

            // ── 左臂（在身体后面） ──
            const laY = this.lArmY;
            if (laY < -2) {
                this.px(cx - 5, gy - 15 + laY, 2, 6, P.hoodie);
                this.px(cx - 5, gy - 16 + laY, 2, 1, P.hand);
            } else {
                this.px(cx - 5, gy - 14 + laY, 2, 6, P.hoodie);
                this.px(cx - 5, gy - 8 + laY, 2, 1, P.hand);
            }

            // ── 身体（修身卫衣） ──
            this.px(cx - 3, gy - 15, 7, 8, P.hoodie);
            this.px(cx - 3, gy - 15, 1, 8, P.hoodieD);
            this.px(cx + 3, gy - 15, 1, 8, P.hoodieD);
            this.px(cx, gy - 14, 1, 6, P.hoodieL);
            this.px(cx - 2, gy - 10, 2, 2, P.pocket);
            this.px(cx + 1, gy - 10, 2, 2, P.pocket);
            this.px(cx - 2, gy - 15, 5, 1, P.hoodieL);
            this.px(cx - 1, gy - 15, 3, 1, P.skinS);

            // ── 右臂（在身体前面） ──
            const raY = this.rArmY;
            if (raY < -2) {
                this.px(cx + 4, gy - 15 + raY, 2, 6, P.hoodie);
                this.px(cx + 4, gy - 16 + raY, 2, 1, P.hand);
            } else {
                this.px(cx + 4, gy - 14 + raY, 2, 6, P.hoodie);
                this.px(cx + 4, gy - 8 + raY, 2, 1, P.hand);
            }

            // ── 脸（更立体） ──
            this.px(cx - 3, gy - 22, 7, 7, P.skin);
            this.px(cx - 3, gy - 22, 1, 2, P.skinS);
            this.px(cx + 3, gy - 22, 1, 2, P.skinS);

            // ── 碎盖发型 ──
            this.px(cx - 4, gy - 26, 9, 5, P.hair);
            this.px(cx - 5, gy - 25, 1, 3, P.hair);
            this.px(cx - 4, gy - 22, 1, 3, P.hair);
            this.px(cx + 4, gy - 22, 1, 2, P.hair);
            this.px(cx + 5, gy - 25, 1, 2, P.hair);
            // 刘海碎盖
            this.px(cx - 4, gy - 22, 2, 1, P.hair);
            this.px(cx - 2, gy - 22, 1, 1, P.hair);
            this.px(cx - 1, gy - 21, 1, 1, P.hair);
            this.px(cx + 1, gy - 22, 2, 1, P.hair);
            this.px(cx + 3, gy - 21, 1, 1, P.hair);
            this.px(cx, gy - 22, 1, 1, P.hair);
            // 发丝高光
            this.px(cx - 2, gy - 26, 1, 1, P.hairH);
            this.px(cx + 1, gy - 25, 1, 1, P.hairH);
            this.px(cx, gy - 26, 2, 1, P.hairH);
            this.px(cx - 3, gy - 24, 1, 1, P.hairH);
            // 呆毛
            this.px(cx - 3, gy - 27, 1, 1, P.hair);
            this.px(cx - 2, gy - 27, 1, 1, P.hairH);

            // ── 眼睛（更锐利） ──
            if (!this.blink) {
                this.px(cx - 3, gy - 20, 1, 1, P.eye);
                this.px(cx - 2, gy - 20, 1, 2, P.eyeW);
                this.px(cx - 1, gy - 20, 1, 2, P.eye);
                this.px(cx - 2, gy - 20, 1, 1, P.eyeH);
                this.px(cx + 1, gy - 20, 1, 2, P.eyeW);
                this.px(cx + 2, gy - 20, 1, 2, P.eye);
                this.px(cx + 3, gy - 20, 1, 1, P.eye);
                this.px(cx + 1, gy - 20, 1, 1, P.eyeH);
            } else {
                this.px(cx - 3, gy - 19, 1, 1, P.eye);
                this.px(cx - 2, gy - 19, 2, 1, P.eye);
                this.px(cx + 1, gy - 19, 2, 1, P.eye);
                this.px(cx + 3, gy - 19, 1, 1, P.eye);
            }

            // ── 眉毛 ──
            this.px(cx - 2, gy - 21, 2, 1, P.hair);
            this.px(cx + 1, gy - 21, 2, 1, P.hair);

            // ── 腮红 ──
            this.px(cx - 3, gy - 18, 1, 1, P.blush);
            this.px(cx + 3, gy - 18, 1, 1, P.blush);

            // ── 嘴巴 ──
            if (this.mouthOpen) {
                this.px(cx - 1, gy - 17, 2, 2, P.mouthO);
            } else {
                this.px(cx, gy - 17, 1, 1, P.mouth);
            }
        }

        update() {
            this.frame++;

            // 眨眼
            this.blinkCD--;
            if (this.blinkCD <= 0 && !this.blink) {
                this.blink = true;
                this.blinkFrames = 0;
            }
            if (this.blink) {
                this.blinkFrames++;
                if (this.blinkFrames > 6) {
                    this.blink = false;
                    this.blinkCD = 60 + Math.random() * 140;
                }
            }

            switch (this.state) {
                case 'idle':
                    this.bobY = Math.sin(this.frame * 0.06) * 0.5;
                    this.lArmY = 0; this.rArmY = 0;
                    this.lLegY = 0; this.rLegY = 0;
                    this.mouthOpen = false;
                    break;

                case 'walk':
                    this.timer++;
                    const w = Math.sin(this.frame * 0.15);
                    this.bobY = Math.abs(w) * -0.8;
                    this.lLegY = w * 1.5;
                    this.rLegY = -w * 1.5;
                    this.lArmY = -w * 0.8;
                    this.rArmY = w * 0.8;
                    this.x += this.walkDir * 0.12;
                    if (this.x > PW - 9) this.walkDir = -1;
                    if (this.x < 9) this.walkDir = 1;
                    if (this.timer > 150) this.set('idle');
                    break;

                case 'wave':
                    this.timer++;
                    this.bobY = Math.sin(this.frame * 0.06) * 0.5;
                    this.rArmY = -5 + Math.sin(this.frame * 0.3) * 2;
                    this.lArmY = 0;
                    this.lLegY = 0; this.rLegY = 0;
                    this.mouthOpen = false;
                    if (this.timer > 100) this.set('idle');
                    break;

                case 'yawn':
                    this.timer++;
                    this.bobY = Math.sin(this.frame * 0.04) * 0.8;
                    const p = this.timer / 120;
                    if (p < 0.3) {
                        const t = p / 0.3;
                        this.lArmY = -t * 5;
                        this.rArmY = -t * 5;
                        this.mouthOpen = true;
                    } else if (p < 0.65) {
                        this.lArmY = -5;
                        this.rArmY = -5;
                        this.mouthOpen = true;
                    } else {
                        const t = (p - 0.65) / 0.35;
                        this.lArmY = -(1 - t) * 5;
                        this.rArmY = -(1 - t) * 5;
                        this.mouthOpen = t > 0.5 ? false : true;
                    }
                    this.lLegY = 0; this.rLegY = 0;
                    if (this.timer > 120) this.set('idle');
                    break;

                case 'jump':
                    this.timer++;
                    if (this.timer < 10) {
                        this.bobY = -this.timer * 0.8;
                        this.lArmY = -this.timer * 0.3;
                        this.rArmY = -this.timer * 0.3;
                    } else if (this.timer < 20) {
                        this.bobY = -(20 - this.timer) * 0.8;
                        this.lArmY = -(20 - this.timer) * 0.3;
                        this.rArmY = -(20 - this.timer) * 0.3;
                    } else {
                        this.set('idle');
                    }
                    this.lLegY = 0; this.rLegY = 0;
                    break;

                case 'sit':
                    this.timer++;
                    this.bobY = 3;
                    this.lLegY = 2; this.rLegY = 2;
                    this.lArmY = 1; this.rArmY = 1;
                    this.mouthOpen = false;
                    if (this.timer > 180) this.set('idle');
                    break;
            }
        }

        set(state) {
            this.state = state;
            this.timer = 0;
            if (state === 'idle') {
                this.lArmY = 0; this.rArmY = 0;
                this.lLegY = 0; this.rLegY = 0;
                this.mouthOpen = false;
            }
            if (state === 'walk') {
                this.walkDir = Math.random() > 0.5 ? 1 : -1;
            }
        }

        onClick() {
            const a = ['jump', 'wave', 'walk'];
            this.set(a[Math.floor(Math.random() * a.length)]);
        }

        autoAct() {
            setTimeout(() => {
                if (this.state === 'idle') {
                    const a = ['walk', 'wave', 'yawn', 'sit'];
                    this.set(a[Math.floor(Math.random() * a.length)]);
                }
                this.autoAct();
            }, 5000 + Math.random() * 4000);
        }

        run() {
            this.update();
            this.ctx.clearRect(0, 0, CW, CH);
            this.draw();
            requestAnimationFrame(() => this.run());
        }
    }

    // 初始化
    const init = () => new PixelPet('pixelPetCanvas');
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
