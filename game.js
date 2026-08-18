/**
 * @typedef {Object} GameConfig
 * @property {number} CANVAS_WIDTH - 캔버스 가로 너비 (px)
 * @property {number} CANVAS_HEIGHT - 캔버스 세로 높이 (px)
 * @property {number} LANE_COUNT - 트랙 레인 개수
 * @property {number} MAX_LIVES - 최대 생명력 수치
 * @property {number} INVINCIBLE_DURATION - 피격 시 무적 지속 시간 (초)
 */

/**
 * 게임 환경 설정 글로벌 상수 객체
 * @type {GameConfig}
 */
const CONFIG = Object.freeze({
    CANVAS_WIDTH: 800,
    CANVAS_HEIGHT: 600,
    LANE_COUNT: 3,
    MAX_LIVES: 5,
    INVINCIBLE_DURATION: 1.0
});

/**
 * @class SoundEngine
 * @description Web Audio API 기반 오디오 신디사이저 및 사운드 관리자.
 * 1. 로비 BGM (사이버 앰비언트)
 * 2. 게임 BGM (업템포 신스웨이브 러닝)
 * 3. 회복 효과음 (백신 아이템 획득 힐링 SFX)
 * 4. 장애물 효과음 (바이러스 충돌 피격 SFX)
 * 5. 게임 종료 효과음 (시스템 다운 게임오버 SFX)
 */
class SoundEngine {
    constructor() {
        /** @type {AudioContext | null} */
        this.ctx = null;
        /** @type {boolean} 전체 음소거 여부 */
        this.isMuted = false;
        /** @type {number} 배경 음악(BGM) 볼륨 (0.0 ~ 1.0) */
        this.bgmVolume = 0.7;
        /** @type {number} 효과음(SFX) 볼륨 (0.0 ~ 1.0) */
        this.sfxVolume = 0.8;

        /** @type {number | null} 로비 BGM 타이머 ID */
        this.lobbyTimer = null;
        /** @type {number | null} 게임 BGM 타이머 ID */
        this.gameBgmTimer = null;
        /** @type {'NONE' | 'LOBBY' | 'GAME'} 현재 재생 중인 BGM 모드 */
        this.currentBgm = 'NONE';

        // BGM 멜로디 시퀀스 노트 (Hz 단위)
        this.notes = {
            C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
            C4: 261.63, E4: 329.63, G4: 392.00, A4: 440.00, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.50
        };

        this.loadSettings();
    }

    /**
     * localStorage에서 사운드 설정 불러오기
     * @returns {void}
     */
    loadSettings() {
        try {
            const saved = localStorage.getItem('ai_cyber_runner_sound_settings');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (typeof parsed.bgmVolume === 'number') this.bgmVolume = parsed.bgmVolume;
                if (typeof parsed.sfxVolume === 'number') this.sfxVolume = parsed.sfxVolume;
                if (typeof parsed.isMuted === 'boolean') this.isMuted = parsed.isMuted;
            }
        } catch (e) {
            console.warn('사운드 설정 로드 오류 (기본값 사용):', e);
        }
    }

    /**
     * localStorage에 사운드 설정 저장하기
     * @returns {void}
     */
    saveSettings() {
        try {
            const data = {
                bgmVolume: this.bgmVolume,
                sfxVolume: this.sfxVolume,
                isMuted: this.isMuted
            };
            localStorage.setItem('ai_cyber_runner_sound_settings', JSON.stringify(data));
        } catch (e) {
            console.warn('사운드 설정 저장 오류:', e);
        }
    }

    /**
     * AudioContext 안전 초기화 (사용자 인터랙션 발생 시 활성화)
     * @returns {void}
     */
    initCtx() {
        try {
            if (!this.ctx) {
                const AudioCtx = window.AudioContext || /** @type {any} */(window).webkitAudioContext;
                if (AudioCtx) {
                    this.ctx = new AudioCtx();
                }
            }
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => {});
            }
        } catch (e) {
            console.warn('AudioContext 생성 예외 안전 처리:', e);
        }
    }

    /**
     * 배경 음악 (BGM) 볼륨 설정
     * @param {number} vol - 0.0 ~ 1.0 범위의 볼륨값
     * @returns {void}
     */
    setBgmVolume(vol) {
        this.bgmVolume = Math.max(0, Math.min(1, vol));
        this.saveSettings();
    }

    /**
     * 효과음 (SFX) 볼륨 설정
     * @param {number} vol - 0.0 ~ 1.0 범위의 볼륨값
     * @returns {void}
     */
    setSfxVolume(vol) {
        this.sfxVolume = Math.max(0, Math.min(1, vol));
        this.saveSettings();
    }

    /**
     * 음소거 토글
     * @returns {boolean} 토글 후 음소거 상태 (true: 음소거됨, false: 켜짐)
     */
    toggleMute() {
        this.isMuted = !this.isMuted;
        if (this.isMuted) {
            this.stopBGM();
        } else {
            this.initCtx();
        }
        this.saveSettings();
        return this.isMuted;
    }

    /**
     * 모든 BGM 재생 중지
     * @returns {void}
     */
    stopBGM() {
        try {
            if (this.lobbyTimer) {
                clearInterval(this.lobbyTimer);
                this.lobbyTimer = null;
            }
            if (this.gameBgmTimer) {
                clearInterval(this.gameBgmTimer);
                this.gameBgmTimer = null;
            }
            this.currentBgm = 'NONE';
        } catch (e) {
            console.warn('stopBGM 예외 처리:', e);
        }
    }

    /**
     * 1. 로비 배경 음악 (Play Lobby BGM)
     * 선택된 캐릭터(삐야: 아늑한 앰비언트 / 오르: 박진감 넘치는 쾌속 템포 신스)에 따라 로비 음악을 다르게 재생합니다.
     * @param {CharacterType} [character='ppiya'] - 선택된 캐릭터 ('ppiya' | 'ore')
     * @returns {void}
     */
    playLobbyBGM(character = 'ppiya') {
        if (this.isMuted) return;
        this.initCtx();
        const targetLobbyKey = `LOBBY_${character.toUpperCase()}`;
        if (this.currentBgm === targetLobbyKey) return;

        this.stopBGM();
        this.currentBgm = /** @type {any} */ (targetLobbyKey);

        if (character === 'ppiya') {
            // 삐야 (Ppiya) 로비 BGM: 밝고 아늑한 앰비언트 신스
            const lobbyNotes = [this.notes.C4, this.notes.E4, this.notes.G4, this.notes.A4];
            let noteIndex = 0;

            const playLobbyStep = () => {
                if (this.isMuted || this.currentBgm !== targetLobbyKey || !this.ctx || this.ctx.state !== 'running') return;
                try {
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();

                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(lobbyNotes[noteIndex], this.ctx.currentTime);

                    const baseGain = 0.05 * this.bgmVolume;
                    gain.gain.setValueAtTime(baseGain, this.ctx.currentTime);
                    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.85);

                    osc.connect(gain);
                    gain.connect(this.ctx.destination);

                    osc.start(this.ctx.currentTime);
                    osc.stop(this.ctx.currentTime + 0.85);

                    noteIndex = (noteIndex + 1) % lobbyNotes.length;
                } catch (e) {
                    console.warn('Lobby BGM ppiya 예외 처리:', e);
                }
            };

            playLobbyStep();
            this.lobbyTimer = /** @type {any} */ (setInterval(playLobbyStep, 800));

        } else {
            // 오르 (Ore) 로비 BGM: 박진감 넘치는 하이템포 쾌속 알페지오 (220ms 템포)
            const oreLobbyNotes = [261.63, 329.63, 392.00, 523.25, 493.88, 392.00, 329.63, 261.63]; // C4, E4, G4, C5, B4, G4, E4, C4
            let noteIndex = 0;

            const playOreLobbyStep = () => {
                if (this.isMuted || this.currentBgm !== targetLobbyKey || !this.ctx || this.ctx.state !== 'running') return;
                try {
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();

                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(oreLobbyNotes[noteIndex], this.ctx.currentTime);

                    const baseGain = 0.08 * this.bgmVolume;
                    gain.gain.setValueAtTime(baseGain, this.ctx.currentTime);
                    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.22);

                    osc.connect(gain);
                    gain.connect(this.ctx.destination);

                    osc.start(this.ctx.currentTime);
                    osc.stop(this.ctx.currentTime + 0.22);

                    noteIndex = (noteIndex + 1) % oreLobbyNotes.length;
                } catch (e) {
                    console.warn('Lobby BGM ore 예외 처리:', e);
                }
            };

            playOreLobbyStep();
            this.lobbyTimer = /** @type {any} */ (setInterval(playOreLobbyStep, 220));
        }
    }

    /**
     * 2. 게임 화면 배경 음악 (Play Game BGM)
     * 선택된 캐릭터(삐야: 경쾌한 신스웨이브 / 오르: 쾌속 박진감 테크노 드라이브)별 고유 BGM을 재생합니다.
     * @param {CharacterType} [character='ppiya'] - 선택 캐릭터 ('ppiya' | 'ore')
     * @returns {void}
     */
    playGameBGM(character = 'ppiya') {
        if (this.isMuted) return;
        this.initCtx();
        const targetBgmKey = `GAME_${character.toUpperCase()}`;
        if (this.currentBgm === targetBgmKey) return;

        this.stopBGM();
        this.currentBgm = /** @type {any} */ (targetBgmKey);

        if (character === 'ppiya') {
            // 삐야 (Ppiya) BGM: 통통 튀는 업템포 신스웨이브 멜로디
            const bassLine = [this.notes.C3, this.notes.C3, this.notes.G3, this.notes.A3, this.notes.F3, this.notes.G3];
            let step = 0;

            const playGameStep = () => {
                if (this.isMuted || !this.currentBgm.startsWith('GAME') || !this.ctx || this.ctx.state !== 'running') return;
                try {
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();

                    osc.type = 'sawtooth';
                    const freq = bassLine[step % bassLine.length];
                    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

                    const baseGain = 0.08 * this.bgmVolume;
                    gain.gain.setValueAtTime(baseGain, this.ctx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.2);

                    osc.connect(gain);
                    gain.connect(this.ctx.destination);

                    osc.start();
                    osc.stop(this.ctx.currentTime + 0.2);

                    step++;
                } catch (e) {
                    // 사운드 방지
                }
            };

            this.gameBgmTimer = /** @type {any} */ (setInterval(playGameStep, 220));

        } else {
            // 오르 (Ore) BGM: 5레인 수호자 트랙에 맞춘 초고속 박진감 테크노 신스 드라이브 (130ms 쾌속 템포)
            const oreNotes = [164.81, 196.00, 220.00, 246.94, 293.66, 329.63, 293.66, 246.94]; // E3, G3, A3, B3, D4, E4, D4, B3
            let step = 0;

            const playOreStep = () => {
                if (this.isMuted || !this.currentBgm.startsWith('GAME') || !this.ctx || this.ctx.state !== 'running') return;
                try {
                    const osc = this.ctx.createOscillator();
                    const subOsc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();

                    const freq = oreNotes[step % oreNotes.length];
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

                    subOsc.type = 'square';
                    subOsc.frequency.setValueAtTime(freq / 2, this.ctx.currentTime); // 1옥타브 하단 묵직한 오실레이터

                    const baseGain = 0.07 * this.bgmVolume;
                    gain.gain.setValueAtTime(baseGain, this.ctx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.12);

                    osc.connect(gain);
                    subOsc.connect(gain);
                    gain.connect(this.ctx.destination);

                    osc.start();
                    subOsc.start();
                    osc.stop(this.ctx.currentTime + 0.12);
                    subOsc.stop(this.ctx.currentTime + 0.12);

                    step++;
                } catch (e) {
                    // 사운드 방지
                }
            };

            this.gameBgmTimer = /** @type {any} */ (setInterval(playOreStep, 130));
        }
    }

    /**
     * 3. 회복 효과음 (Play Heal SFX - 백신 아이템 획득 맑은 아르페지오)
     * @returns {void}
     */
    playHealSFX() {
        if (this.isMuted || this.sfxVolume <= 0) return;
        this.initCtx();
        if (!this.ctx || this.ctx.state !== 'running') return;

        try {
            const healSeq = [this.notes.C5, this.notes.E5, this.notes.G5, this.notes.C6];
            healSeq.forEach((freq, idx) => {
                if (!this.ctx) return;
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, this.ctx.currentTime + idx * 0.08);

                const baseGain = 0.15 * this.sfxVolume;
                gain.gain.setValueAtTime(baseGain, this.ctx.currentTime + idx * 0.08);
                gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + idx * 0.08 + 0.2);

                osc.connect(gain);
                gain.connect(this.ctx.destination);

                osc.start(this.ctx.currentTime + idx * 0.08);
                osc.stop(this.ctx.currentTime + idx * 0.08 + 0.2);
            });
        } catch (e) {
            // 사운드 재생 에러 무시
        }
    }

    /**
     * 4. 장애물 효과음 (Play Obstacle SFX - 바이러스 충돌 전자 피격 노이즈)
     * @returns {void}
     */
    playObstacleSFX() {
        if (this.isMuted || this.sfxVolume <= 0) return;
        this.initCtx();
        if (!this.ctx || this.ctx.state !== 'running') return;

        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(220, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(60, this.ctx.currentTime + 0.3);

            const baseGain = 0.25 * this.sfxVolume;
            gain.gain.setValueAtTime(baseGain, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.3);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start();
            osc.stop(this.ctx.currentTime + 0.3);
        } catch (e) {
            // 사운드 재생 에러 무시
        }
    }

    /**
     * 5. 게임 종료 효과음 (Play Game Over SFX - 시스템 다운 하강 멜로디)
     * @returns {void}
     */
    playGameOverSFX() {
        if (this.isMuted || this.sfxVolume <= 0) return;
        this.initCtx();
        if (!this.ctx || this.ctx.state !== 'running') return;

        this.stopBGM();

        try {
            const overSeq = [this.notes.C4, this.notes.G3, this.notes.E3, this.notes.C3];
            overSeq.forEach((freq, idx) => {
                if (!this.ctx) return;
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                osc.type = 'square';
                osc.frequency.setValueAtTime(freq, this.ctx.currentTime + idx * 0.15);

                const baseGain = 0.15 * this.sfxVolume;
                gain.gain.setValueAtTime(baseGain, this.ctx.currentTime + idx * 0.15);
                gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + idx * 0.15 + 0.3);

                osc.connect(gain);
                gain.connect(this.ctx.destination);

                osc.start(this.ctx.currentTime + idx * 0.15);
                osc.stop(this.ctx.currentTime + idx * 0.15 + 0.3);
            });
        } catch (e) {
            // 사운드 재생 에러 무시
        }
    }
}

/**
 * 사이버 공간 배경에 표시될 코드 및 비트 스트림 텍스트 모음
 * @type {string[]}
 */
const CYBER_CODE_SNIPPETS = [
    "0101010101010101",
    "const AI = new CyberBrain();",
    "if (security === true) protect();",
    "function patchVirus() { clean(); }",
    "import tensorflow as tf",
    "1010101010101010",
    "System.out.println('RUN!');",
    "<div class='cyber-runner'></div>",
    "await ai.optimizePath();",
    "ERR_404_VIRUS_DETECTED"
];

/**
 * 레인의 X 좌표를 계산하는 헬퍼 함수
 * @param {number} lane - 레인 인덱스 (0 ~ laneCount-1)
 * @param {number} [laneCount=3] - 총 레인 개수 (3 또는 5)
 * @returns {number} 해당 레인의 중앙 X 좌표
 */
function getLaneX(lane, laneCount = 3) {
    const laneWidth = CONFIG.CANVAS_WIDTH / laneCount;
    return laneWidth * lane + laneWidth / 2;
}

/**
 * 캐릭터별 정밀 Bounding Box 크롭 좌표 맵
 * 삐야.png 및 오르.png 내 실제 픽셀 경계를 정밀 측정한 좌표
 */
const CHARACTER_CROP_BOUNDS = Object.freeze({
    ppiya: {
        front: { x: 39, y: 48, w: 217, h: 293 },
        back: { x: 290, y: 45, w: 220, h: 296 },
        right: { x: 540, y: 48, w: 210, h: 293 },
        left: { x: 775, y: 50, w: 210, h: 291 }
    },
    ore: {
        front: { x: 38, y: 62, w: 218, h: 279 },
        back: { x: 295, y: 64, w: 215, h: 277 },
        right: { x: 530, y: 60, w: 220, h: 281 },
        left: { x: 785, y: 57, w: 210, h: 284 }
    }
});

/**
 * @typedef {'RUNNING' | 'HEAL' | 'DAMAGE'} CharacterAnimState
 */

/**
 * @class Player
 * @description 플레이어 캐릭터 객체 (위치, 선택 캐릭터, 생명력, 무적, 달리기/회복/피격 애니메이션 관리)
 */
class Player {
    /**
     * Player 생성자
     * @param {CharacterType} character - 선택된 캐릭터 코드 ('ppiya' | 'ore')
     * @param {number} [laneCount=3] - 게임 트랙 레인 수 (3 또는 5)
     */
    constructor(character, laneCount = 3) {
        /** @type {CharacterType} */
        this.character = character;
        /** @type {number} 전체 트랙 레인 수 */
        this.laneCount = laneCount;
        /** @type {number} 초기 시작 레인 인덱스 (중앙 레인) */
        this.lane = Math.floor(laneCount / 2);
        /** @type {number} 현재 X 좌표 */
        this.x = getLaneX(this.lane, this.laneCount);
        /** @type {number} 목표 X 좌표 (부드러운 이동용) */
        this.targetX = getLaneX(this.lane, this.laneCount);
        /** @type {number} Y 좌표 (화면 하단 부근 고정) */
        this.y = 475;
        
        // 삐야(3레인)와 오르(5레인) 캐릭터 간 크기 비율 최적화
        if (character === 'ppiya') {
            /** @type {number} 캐릭터 너비 */
            this.width = 85;
            /** @type {number} 캐릭터 높이 */
            this.height = 98;
        } else {
            /** @type {number} 캐릭터 너비 (5레인 트랙에 맞춘 슬림 조정) */
            this.width = 75;
            /** @type {number} 캐릭터 높이 */
            this.height = 92;
        }

        /** @type {number} 현재 생명력 */
        this.lives = CONFIG.MAX_LIVES;
        /** @type {boolean} 무적 여부 */
        this.isInvincible = false;
        /** @type {number} 무적 상태 타이머 */
        this.invincibleTimer = 0;
        /** @type {number} 점멸 애니메이션 카운터 */
        this.blinkCounter = 0;
        /** @type {number} X축 이동 속도 (틸트 효과용) */
        this.velX = 0;

        // 상태별 애니메이션 관리 속성
        /** @type {CharacterAnimState} 현재 애니메이션 상태 */
        this.animState = 'RUNNING';
        /** @type {number} 스페셜 상태(HEAL/DAMAGE) 지속 타이머 (초) */
        this.stateTimer = 0;
        /** @type {number} 달리기 5프레임 애니메이션 현재 인덱스 (0~4) */
        this.runFrameIndex = 0;
        /** @type {number} 달리기 프레임 전환 경과 시간 */
        this.runFrameTimer = 0;
    }

    /**
     * 레인 이동 처리
     * @param {-1 | 1} dir - -1: 왼쪽 이동, 1: 오른쪽 이동
     * @returns {void}
     */
    move(dir) {
        const nextLane = this.lane + dir;
        if (nextLane >= 0 && nextLane < this.laneCount) {
            this.lane = nextLane;
            this.targetX = getLaneX(this.lane, this.laneCount);
        }
    }

    /**
     * 백신 획득 회복 애니메이션 트리거 (손 번쩍 환호 포즈)
     * @returns {void}
     */
    triggerHeal() {
        this.animState = 'HEAL';
        this.stateTimer = 0.8; // 0.8초간 환호 포즈 유지
    }

    /**
     * 장애물 충돌 피격 애니메이션 트리거 (비틀거림/콰당 포즈)
     * @returns {void}
     */
    triggerDamage() {
        this.animState = 'DAMAGE';
        this.stateTimer = 0.9; // 0.9초간 피격 포즈 유지
    }

    /**
     * 프레임 업데이트 (위치 LERP, 무적 시간, 애니메이션 프레임 전환)
     * @param {number} deltaTime - 프레임 간 경과 시간 (초)
     * @returns {void}
     */
    update(deltaTime) {
        // 부드러운 레인 이동 (LERP)
        const prevX = this.x;
        this.x += (this.targetX - this.x) * 15 * deltaTime;
        
        // 레인 이동 속도 계산 (좌우 틸트 연출용)
        this.velX = this.x - prevX;

        // 스페셜 상태(HEAL / DAMAGE) 타이머 처리
        if (this.stateTimer > 0) {
            this.stateTimer -= deltaTime;
            if (this.stateTimer <= 0) {
                this.stateTimer = 0;
                this.animState = 'RUNNING'; // 다시 일반 달리기 상태로 복귀
            }
        }

        // 달리기 5개 모션 프레임전환 (0.07초마다 발걸음 전환)
        this.runFrameTimer += deltaTime;
        if (this.runFrameTimer >= 0.07) {
            this.runFrameTimer = 0;
            this.runFrameIndex = (this.runFrameIndex + 1) % 5;
        }

        // 무적 상태 타이머 차감
        if (this.isInvincible) {
            this.invincibleTimer -= deltaTime;
            this.blinkCounter += deltaTime * 20;
            if (this.invincibleTimer <= 0) {
                this.isInvincible = false;
                this.invincibleTimer = 0;
            }
        }
    }

    /**
     * 대미지 입음 처리 (생명 -1 및 피격 애니메이션 트리거)
     * @returns {boolean} 사망 여부 (생명이 0이 되었는지)
     */
    takeDamage() {
        if (this.isInvincible) return false;

        this.lives = Math.max(0, this.lives - 1);
        this.isInvincible = true;
        this.invincibleTimer = CONFIG.INVINCIBLE_DURATION;
        this.triggerDamage(); // 피격 포즈 트리거
        return this.lives <= 0;
    }

    /**
     * 백신 획득 시 생명력 회복 및 회복 애니메이션 트리거
     * @returns {void}
     */
    heal() {
        this.lives = Math.min(CONFIG.MAX_LIVES, this.lives + 1);
        this.triggerHeal(); // 회복 환호 포즈 트리거
    }

    /**
     * 캔버스 렌더링 (달리기 5프레임 / 회복 / 피격 상태별 스프라이트 draw)
     * @param {CanvasRenderingContext2D} ctx - Canvas 2D 컨텍스트
     * @param {Object<string, HTMLImageElement>} animImages - 캐릭터 애니메이션 이미지 맵
     * @returns {void}
     */
    draw(ctx, animImages) {
        // 무적 시간 동안 깜빡임 효과
        if (this.isInvincible && Math.floor(this.blinkCounter) % 2 === 0) {
            ctx.globalAlpha = 0.4;
        } else {
            ctx.globalAlpha = 1.0;
        }

        // 좌우 이동 시 캐릭터 약간 기울임 (Tilt angle)
        const tiltAngle = (this.velX / 20) * (Math.PI / 180);

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(tiltAngle);

        // 현재 애니메이션 상태별 적절한 스프라이트 키 선택
        let spriteKey = `${this.character}_run${this.runFrameIndex + 1}`;
        let baseHeight = this.height;
        let offsetY = 0;

        if (this.animState === 'HEAL') {
            spriteKey = `${this.character}_heal`;
            baseHeight = this.height * 1.35; // 회복 이펙트 표현용 높이 확장
            offsetY = -10; // 상단 하트 이펙트로 인한 발 위치 보정
        } else if (this.animState === 'DAMAGE') {
            spriteKey = `${this.character}_damage`;
            baseHeight = this.height * 1.3; // 피격 이펙트 표현용 높이 확장
            if (this.character === 'ppiya') {
                offsetY = 5;
            }
        }

        const img = animImages[spriteKey];

        // 이미지가 로드된 경우 종횡비(Aspect Ratio) 보정하여 렌더링
        if (img && img.complete && img.naturalWidth !== 0) {
            const aspectRatio = img.naturalWidth / img.naturalHeight;
            const drawHeight = baseHeight;
            const drawWidth = drawHeight * aspectRatio;

            ctx.drawImage(
                img,
                -drawWidth / 2,
                -drawHeight / 2 + offsetY,
                drawWidth,
                drawHeight
            );
        } else {
            // 이미지 미로드 시 폴백 도형 렌더링
            ctx.beginPath();
            ctx.arc(0, 0, this.width / 2, 0, Math.PI * 2);
            ctx.fillStyle = this.character === 'ppiya' ? '#ffe600' : '#ffffff';
            ctx.shadowColor = this.character === 'ppiya' ? '#ffe600' : '#00f0ff';
            ctx.shadowBlur = 15;
            ctx.fill();
            ctx.fillStyle = '#000000';
            ctx.font = 'bold 14px Orbitron';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(this.character === 'ppiya' ? '삐야' : '오르', 0, 0);
        }

        ctx.restore();
        ctx.globalAlpha = 1.0;
    }
}

/**
 * @class Obstacle
 * @description 바이러스 장애물 클래스
 */
class Obstacle {
    /**
     * Obstacle 생성자
     * @param {number} lane - 등장 레인 인덱스
     * @param {'small' | 'large' | 'fast'} [type='small'] - 바이러스 형태 종류
     * @param {number} [laneCount=3] - 총 레인 개수
     */
    constructor(lane, type = 'small', laneCount = 3) {
        /** @type {number} */
        this.lane = lane;
        /** @type {number} */
        this.laneCount = laneCount;
        /** @type {number} */
        this.x = getLaneX(lane, laneCount);
        /** @type {number} */
        this.y = -50;
        /** @type {'small' | 'large' | 'fast'} */
        this.type = type;
        /** @type {number} */
        this.radius = type === 'large' ? 32 : 24;
        /** @type {number} 추가 이동 속도 가중치 */
        this.speedMultiplier = type === 'fast' ? 1.4 : 1.0;
        /** @type {number} 회전 애니메이션 각도 */
        this.rotation = 0;
    }

    /**
     * 장애물 위치 업데이트
     * @param {number} deltaTime - 프레임 간 경과 시간
     * @param {number} gameSpeed - 현재 게임 속도
     * @returns {void}
     */
    update(deltaTime, gameSpeed) {
        this.y += gameSpeed * this.speedMultiplier * deltaTime;
        this.rotation += 2 * deltaTime;
    }

    /**
     * 바이러스 장애물 렌더링
     * @param {CanvasRenderingContext2D} ctx - 캔버스 2D 컨텍스트
     * @returns {void}
     */
    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);

        // 네온 글로우 스타일 바이러스 그리기
        ctx.beginPath();
        const spikes = 8;
        for (let i = 0; i < spikes * 2; i++) {
            const r = (i % 2 === 0) ? this.radius : this.radius * 0.6;
            const angle = (i / spikes) * Math.PI;
            const x = r * Math.cos(angle);
            const y = r * Math.sin(angle);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();

        const color = this.type === 'fast' ? '#ff007f' : (this.type === 'large' ? '#ff3300' : '#ff0055');
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 중심 바이러스 핵
        ctx.beginPath();
        ctx.arc(0, 0, this.radius * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = '#000000';
        ctx.fill();

        ctx.restore();
    }
}

/**
 * @class Vaccine
 * @description 백신 아이템 클래스
 */
class Vaccine {
    /**
     * Vaccine 생성자
     * @param {number} lane - 백신 생성 레인 인덱스
     * @param {number} [laneCount=3] - 총 레인 개수
     */
    constructor(lane, laneCount = 3) {
        /** @type {number} */
        this.lane = lane;
        /** @type {number} */
        this.laneCount = laneCount;
        /** @type {number} */
        this.x = getLaneX(lane, laneCount);
        /** @type {number} */
        this.y = -50;
        /** @type {number} */
        this.radius = 20;
        /** @type {number} */
        this.bobbing = 0;
    }

    /**
     * 백신 위치 업데이트
     * @param {number} deltaTime - 경과 시간
     * @param {number} gameSpeed - 게임 전진 속도
     * @returns {void}
     */
    update(deltaTime, gameSpeed) {
        this.y += gameSpeed * deltaTime;
        this.bobbing += 5 * deltaTime;
    }

    /**
     * 백신 렌더링
     * @param {CanvasRenderingContext2D} ctx 
     * @returns {void}
     */
    draw(ctx) {
        ctx.save();
        const floatY = this.y + Math.sin(this.bobbing) * 4;
        ctx.translate(this.x, floatY);

        // 네온 백신 캡슐/주사기 형태 그리기
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 240, 255, 0.2)';
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 15;
        ctx.fill();
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 백신 이모지 💉 텍스트
        ctx.font = '20px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💉', 0, 0);

        ctx.restore();
    }
}

/**
 * @class BackgroundStream
 * @description 사이버 세상 매트릭스 백그라운드 렌더러
 */
class BackgroundStream {
    constructor() {
        /** @type {Array<{text: string, x: number, y: number, speed: number, opacity: number}>} */
        this.lines = [];
        this.init();
    }

    /**
     * 코드 스크림 객체 초기화
     * @returns {void}
     */
    init() {
        this.lines = [];
        for (let i = 0; i < 25; i++) {
            this.lines.push({
                text: CYBER_CODE_SNIPPETS[Math.floor(Math.random() * CYBER_CODE_SNIPPETS.length)],
                x: Math.random() * CONFIG.CANVAS_WIDTH,
                y: Math.random() * CONFIG.CANVAS_HEIGHT,
                speed: 40 + Math.random() * 80,
                opacity: 0.15 + Math.random() * 0.3
            });
        }
    }

    /**
     * 프레임 업데이트
     * @param {number} deltaTime 
     * @param {number} gameSpeed 
     * @returns {void}
     */
    update(deltaTime, gameSpeed) {
        for (const line of this.lines) {
            line.y += (line.speed + gameSpeed * 0.2) * deltaTime;
            if (line.y > CONFIG.CANVAS_HEIGHT + 30) {
                line.y = -30;
                line.x = Math.random() * CONFIG.CANVAS_WIDTH;
                line.text = CYBER_CODE_SNIPPETS[Math.floor(Math.random() * CYBER_CODE_SNIPPETS.length)];
            }
        }
    }

    /**
     * 사이버 레인 그리드 및 코드 텍스트 렌더링
     * @param {CanvasRenderingContext2D} ctx 
     * @param {number} [laneCount=3] - 레인 수 (3 또는 5)
     * @returns {void}
     */
    draw(ctx, laneCount = 3) {
        // 1. 레인 구분선 동적 그리기 (laneCount 개수에 따라 세로선 구분)
        const laneWidth = CONFIG.CANVAS_WIDTH / laneCount;
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
        ctx.lineWidth = 2;
        ctx.setLineDash([15, 15]);

        for (let i = 1; i < laneCount; i++) {
            ctx.beginPath();
            ctx.moveTo(laneWidth * i, 0);
            ctx.lineTo(laneWidth * i, CONFIG.CANVAS_HEIGHT);
            ctx.stroke();
        }
        ctx.restore();

        // 2. 흘러가는 코드 스크림 텍스트
        ctx.save();
        ctx.font = '12px Orbitron, monospace';
        for (const line of this.lines) {
            ctx.fillStyle = `rgba(0, 240, 255, ${line.opacity})`;
            ctx.fillText(line.text, line.x, line.y);
        }
        ctx.restore();
    }
}

/**
 * @class GameEngine
 * @description 전체 게임 상태 관리, 게임 루프, 입력 이벤트 처리 메인 클래스
 */
class GameEngine {
    constructor() {
        /** @type {HTMLCanvasElement} */
        this.canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('gameCanvas'));
        /** @type {CanvasRenderingContext2D} */
        this.ctx = this.canvas.getContext('2d');

        /** @type {GameState} */
        this.state = 'MENU';

        /** @type {CharacterType} */
        this.selectedCharacter = 'ppiya';

        /** @type {Player | null} */
        this.player = null;

        /** @type {Obstacle[]} */
        this.obstacles = [];

        /** @type {Vaccine[]} */
        this.vaccines = [];

        /** @type {BackgroundStream} */
        this.bgStream = new BackgroundStream();

        // 게임 능력치 및 점수 변수
        this.baseSpeed = 260; // 기본 이동 속도 (px/sec)
        this.currentSpeed = 260;
        this.distance = 0;
        this.score = 0;
        this.vaccinesCollected = 0;
        this.highScore = this.loadHighScore();

        // 장애물/백신 타이머
        this.obstacleTimer = 0;
        this.obstacleInterval = 1.6; // 초 단위 생성 간격
        this.vaccineTimer = 0;
        this.vaccineInterval = 4.5;

        // 애니메이션 자산 사전 로딩 (달리기 5프레임, 회복, 피격)
        /** @type {Object<string, HTMLImageElement>} */
        this.animImages = {};

        const charTypes = ['ppiya', 'ore'];
        for (const char of charTypes) {
            const v = '?v=20';
            // 1~5 달리기 프레임 로드
            for (let i = 1; i <= 5; i++) {
                const key = `${char}_run${i}`;
                const img = new Image();
                img.src = `assets/${key}.png${v}`;
                this.animImages[key] = img;
            }

            // 회복(Heal) 자산 로드
            const healKey = `${char}_heal`;
            const healImg = new Image();
            healImg.src = `assets/${healKey}.png${v}`;
            this.animImages[healKey] = healImg;

            // 피격(Damage) 자산 로드
            const damageKey = `${char}_damage`;
            const damageImg = new Image();
            damageImg.src = `assets/${damageKey}.png${v}`;
            this.animImages[damageKey] = damageImg;
        }

        /** @type {number} 마지막 프레임 시간 */
        this.lastTime = 0;

        // UI DOM 요소 참조
        this.dom = {
            hud: document.getElementById('hud'),
            livesDisplay: document.getElementById('livesDisplay'),
            scoreDisplay: document.getElementById('scoreDisplay'),
            distanceDisplay: document.getElementById('distanceDisplay'),
            vaccineDisplay: document.getElementById('vaccineDisplay'),
            mainMenu: document.getElementById('mainMenuOverlay'),
            gameOver: document.getElementById('gameOverOverlay'),
            instructionModal: document.getElementById('instructionModal'),
            settingsModal: document.getElementById('settingsModal'),
            bgmVolumeSlider: /** @type {HTMLInputElement} */ (document.getElementById('bgmVolumeSlider')),
            sfxVolumeSlider: /** @type {HTMLInputElement} */ (document.getElementById('sfxVolumeSlider')),
            bgmVolumeVal: document.getElementById('bgmVolumeVal'),
            sfxVolumeVal: document.getElementById('sfxVolumeVal'),
            btnSettingsMute: document.getElementById('btnSettingsMute'),
            btnSettingsMenu: document.getElementById('btnSettingsMenu'),
            btnHudHome: document.getElementById('btnHudHome'),
            touchControls: document.getElementById('touchControls'),
            mainHighScore: document.getElementById('mainHighScore'),
            finalScore: document.getElementById('finalScore'),
            finalDistance: document.getElementById('finalDistance'),
            finalVaccine: document.getElementById('finalVaccine'),
            finalHighScore: document.getElementById('finalHighScore')
        };

        // 사운드 엔진 인스턴스 생성
        this.soundEngine = new SoundEngine();

        this.initEvents();
        this.syncSettingsUI();
        this.updateUI();
        this.showMenu(); // 메뉴 시작 및 로비 BGM 재생
        this.startLoop();
    }

    /**
     * 진행 중인 게임 일시 정지 (Pause Game)
     * @returns {void}
     */
    pauseGame() {
        if (this.state === 'PLAYING') {
            this.state = 'PAUSED';
        }
    }

    /**
     * 일시 정지된 게임 재개 (Resume Game)
     * @returns {void}
     */
    resumeGame() {
        if (this.state === 'PAUSED') {
            this.state = 'PLAYING';
            this.lastTime = 0; // 프레임 시간 보정 (일시 정지 동안 누적된 타임스탬프 튐 방지)
        }
    }

    /**
     * 사운드 설정 UI (슬라이더 및 음소거 버튼) 동기화
     * @returns {void}
     */
    syncSettingsUI() {
        const bgmPercent = Math.round(this.soundEngine.bgmVolume * 100);
        const sfxPercent = Math.round(this.soundEngine.sfxVolume * 100);

        if (this.dom.bgmVolumeSlider) this.dom.bgmVolumeSlider.value = bgmPercent.toString();
        if (this.dom.bgmVolumeVal) this.dom.bgmVolumeVal.textContent = `${bgmPercent}%`;

        if (this.dom.sfxVolumeSlider) this.dom.sfxVolumeSlider.value = sfxPercent.toString();
        if (this.dom.sfxVolumeVal) this.dom.sfxVolumeVal.textContent = `${sfxPercent}%`;

        if (this.dom.btnSettingsMute) {
            if (this.soundEngine.isMuted) {
                this.dom.btnSettingsMute.textContent = '🔇 전체 음소거 중';
                this.dom.btnSettingsMute.classList.add('muted');
            } else {
                this.dom.btnSettingsMute.textContent = '🔊 소리 켜짐';
                this.dom.btnSettingsMute.classList.remove('muted');
            }
        }
    }

    /**
     * localStorage에서 최고 점수 불러오기
     * @returns {number}
     */
    loadHighScore() {
        try {
            const saved = localStorage.getItem('ai_cyber_runner_highscore');
            return saved ? parseInt(saved, 10) : 0;
        } catch (e) {
            console.warn('localStorage 접근 불가:', e);
            return 0;
        }
    }

    /**
     * 최고 점수 저장
     * @param {number} newScore 
     */
    saveHighScore(newScore) {
        if (newScore > this.highScore) {
            this.highScore = newScore;
            try {
                localStorage.setItem('ai_cyber_runner_highscore', newScore.toString());
            } catch (e) {
                console.warn('localStorage 저장 실패:', e);
            }
        }
    }

    /**
     * 키보드 및 버튼 클릭 이벤트 바인딩
     * @returns {void}
     */
    initEvents() {
        // 키보드 조작 (Left, Right, A, D, Esc)
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // ESC 키 누를 시 설정 모달 또는 게임 설명 모달 닫기
                if (this.dom.settingsModal && !this.dom.settingsModal.classList.contains('hidden')) {
                    this.dom.settingsModal.classList.add('hidden');
                    this.resumeGame();
                }
                this.dom.instructionModal?.classList.add('hidden');
            }

            if (this.state !== 'PLAYING' || !this.player) return;

            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
                this.player.move(-1);
            } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
                this.player.move(1);
            }
        });

        // 톱니바퀴 설정 버튼 클릭 (게임 진행 중이면 일시 정지)
        document.getElementById('btnSettings')?.addEventListener('click', () => {
            this.soundEngine.initCtx();
            if (this.state === 'PLAYING') {
                this.pauseGame();
            }
            this.syncSettingsUI();
            this.dom.settingsModal?.classList.remove('hidden');
        });

        // 설정 모달 닫기 버튼 클릭 (일시 정지 상태이면 게임 재개)
        document.getElementById('btnCloseSettings')?.addEventListener('click', () => {
            this.dom.settingsModal?.classList.add('hidden');
            if (this.state === 'PAUSED') {
                this.resumeGame();
            }
        });

        // 설정 모달 내 '메인 메뉴로' 버튼 클릭 (초기 메인 화면으로 이동)
        document.getElementById('btnSettingsMenu')?.addEventListener('click', () => {
            this.dom.settingsModal?.classList.add('hidden');
            this.showMenu();
        });

        // 게임 진행 중 HUD 영역의 홈 (메인 메뉴) 버튼 클릭
        document.getElementById('btnHudHome')?.addEventListener('click', () => {
            this.soundEngine.initCtx();
            this.showMenu();
        });

        // BGM 볼륨 슬라이더 체인지 이벤트
        this.dom.bgmVolumeSlider?.addEventListener('input', (e) => {
            const target = /** @type {HTMLInputElement} */ (e.target);
            const val = parseFloat(target.value) / 100;
            this.soundEngine.setBgmVolume(val);
            this.syncSettingsUI();
        });

        // SFX 볼륨 슬라이더 체인지 이벤트
        this.dom.sfxVolumeSlider?.addEventListener('input', (e) => {
            const target = /** @type {HTMLInputElement} */ (e.target);
            const val = parseFloat(target.value) / 100;
            this.soundEngine.setSfxVolume(val);
            this.syncSettingsUI();
        });

        // 설정 모달 내 음소거 토글 버튼
        this.dom.btnSettingsMute?.addEventListener('click', () => {
            this.soundEngine.toggleMute();
            this.syncSettingsUI();
        });

        // 캐릭터 선택 카드 클릭 (선택 시 로비 음악 변경)
        const charPpiyaCard = document.getElementById('charPpiya');
        const charOreCard = document.getElementById('charOre');

        charPpiyaCard?.addEventListener('click', () => {
            this.selectedCharacter = 'ppiya';
            charPpiyaCard.classList.add('selected');
            charOreCard?.classList.remove('selected');
            this.soundEngine.initCtx();
            this.soundEngine.playLobbyBGM('ppiya');
        });

        charOreCard?.addEventListener('click', () => {
            this.selectedCharacter = 'ore';
            charOreCard.classList.add('selected');
            charPpiyaCard?.classList.remove('selected');
            this.soundEngine.initCtx();
            this.soundEngine.playLobbyBGM('ore');
        });

        // 게임 시작 버튼
        document.getElementById('btnStartGame')?.addEventListener('click', () => {
            this.startGame();
        });

        // 게임 방법 설명 모달
        document.getElementById('btnHowToPlay')?.addEventListener('click', () => {
            this.dom.instructionModal?.classList.remove('hidden');
        });

        document.getElementById('btnCloseInstruction')?.addEventListener('click', () => {
            this.dom.instructionModal?.classList.add('hidden');
        });

        // 재시작 및 메뉴 돌아가기 버튼
        document.getElementById('btnRestart')?.addEventListener('click', () => {
            this.startGame();
        });

        document.getElementById('btnBackToMenu')?.addEventListener('click', () => {
            this.showMenu();
        });

        // 온스크린 터치/클릭 버튼
        document.getElementById('btnLeft')?.addEventListener('click', () => {
            if (this.state === 'PLAYING' && this.player) this.player.move(-1);
        });

        document.getElementById('btnRight')?.addEventListener('click', () => {
            if (this.state === 'PLAYING' && this.player) this.player.move(1);
        });
    }

    /**
     * 현재 선택된 캐릭터의 트랙 레인 수 반환
     * 삐야(ppiya): 3레인 / 오르(ore): 5레인
     * @returns {number} 레인 수
     */
    get laneCount() {
        return this.selectedCharacter === 'ore' ? 5 : 3;
    }

    /**
     * 메인 메뉴 표시 (로비 BGM 1. 재생)
     */
    showMenu() {
        this.state = 'MENU';
        this.dom.mainMenu?.classList.remove('hidden');
        this.dom.gameOver?.classList.add('hidden');
        this.dom.hud?.classList.add('hidden');
        this.dom.btnHudHome?.classList.add('hidden');
        this.dom.touchControls?.classList.add('hidden');
        if (this.dom.mainHighScore) {
            this.dom.mainHighScore.textContent = this.highScore.toLocaleString();
        }

        // 1. 선택된 캐릭터에 따른 로비 배경 음악 재생
        this.soundEngine.playLobbyBGM(this.selectedCharacter);
    }

    /**
     * 게임 새 세션 시작 (게임 화면 BGM 2. 재생)
     */
    startGame() {
        this.state = 'PLAYING';
        const currentLanes = this.laneCount;
        this.player = new Player(this.selectedCharacter, currentLanes);
        this.obstacles = [];
        this.vaccines = [];
        this.distance = 0;
        this.score = 0;
        this.vaccinesCollected = 0;
        this.currentSpeed = this.baseSpeed;
        this.obstacleTimer = 0;
        this.vaccineTimer = 0;

        // UI 오버레이 숨기기 및 HUD 표시
        this.dom.mainMenu?.classList.add('hidden');
        this.dom.gameOver?.classList.add('hidden');
        this.dom.hud?.classList.remove('hidden');
        this.dom.btnHudHome?.classList.remove('hidden');
        this.dom.touchControls?.classList.remove('hidden');

        this.updateHUD();

        // 2. 게임 화면 배경 음악 재생 (선택된 캐릭터 고유 BGM 재생)
        this.soundEngine.playGameBGM(this.selectedCharacter);
    }

    /**
     * 게임 오버 처리 (게임 종료 효과음 5. 재생)
     */
    gameOver() {
        this.state = 'GAMEOVER';
        this.saveHighScore(Math.floor(this.score));

        // 5. 게임 종료 효과음 재생
        this.soundEngine.playGameOverSFX();

        // 게임 오버 통계 업데이트
        if (this.dom.finalScore) this.dom.finalScore.textContent = Math.floor(this.score).toLocaleString();
        if (this.dom.finalDistance) this.dom.finalDistance.textContent = `${Math.floor(this.distance)}m`;
        if (this.dom.finalVaccine) this.dom.finalVaccine.textContent = `${this.vaccinesCollected}개`;
        if (this.dom.finalHighScore) this.dom.finalHighScore.textContent = this.highScore.toLocaleString();

        this.dom.hud?.classList.add('hidden');
        this.dom.btnHudHome?.classList.add('hidden');
        this.dom.touchControls?.classList.add('hidden');
        this.dom.gameOver?.classList.remove('hidden');
    }

    /**
     * HUD UI 갱신
     */
    updateHUD() {
        if (!this.player) return;

        // 하트 생명력 렌더링
        let heartsStr = '';
        for (let i = 0; i < CONFIG.MAX_LIVES; i++) {
            heartsStr += i < this.player.lives ? '❤️' : '🖤';
        }

        if (this.dom.livesDisplay) this.dom.livesDisplay.textContent = heartsStr;
        if (this.dom.scoreDisplay) this.dom.scoreDisplay.textContent = Math.floor(this.score).toLocaleString();
        if (this.dom.distanceDisplay) this.dom.distanceDisplay.textContent = `${Math.floor(this.distance)}m`;
        if (this.dom.vaccineDisplay) this.dom.vaccineDisplay.textContent = this.vaccinesCollected.toString();
    }

    /**
     * 초기 UI 상태 업데이트
     */
    updateUI() {
        if (this.dom.mainHighScore) {
            this.dom.mainHighScore.textContent = this.highScore.toLocaleString();
        }
    }

    /**
     * 장애물 무작위 생성 (캐릭터별 레인 수 동적 적용)
     */
    spawnObstacle() {
        const lane = Math.floor(Math.random() * this.laneCount);
        const rand = Math.random();
        let type = 'small';
        if (rand > 0.75) type = 'large';
        else if (rand > 0.5) type = 'fast';

        this.obstacles.push(new Obstacle(lane, type, this.laneCount));
    }

    /**
     * 백신 아이템 무작위 생성 (캐릭터별 레인 수 동적 적용)
     */
    spawnVaccine() {
        const lane = Math.floor(Math.random() * this.laneCount);
        this.vaccines.push(new Vaccine(lane, this.laneCount));
    }

    /**
     * 메인 프레임 업데이트 로직
     * @param {number} deltaTime - 이전 프레임으로부터의 경과 시간 (초)
     */
    update(deltaTime) {
        // 배경 스크롤 업데이트 (PAUSED 상태가 아니면 부드럽게 흐름)
        this.bgStream.update(deltaTime, this.state === 'PLAYING' ? this.currentSpeed : (this.state === 'PAUSED' ? 0 : 50));

        if (this.state !== 'PLAYING' || !this.player) return;

        // 1. 거리 및 속도 상승 난이도 조절
        this.distance += (this.currentSpeed / 20) * deltaTime; // 20px 당 1m
        this.score += 15 * deltaTime; // 거리 기본 점수
        this.currentSpeed = this.baseSpeed + Math.floor(this.distance / 100) * 15; // 100m마다 속도 증가

        // 2. 장애물 생성 조절 (속도가 증가하면 장애물 생성 주기도 짧아짐)
        this.obstacleTimer += deltaTime;
        const dynamicObstacleInterval = Math.max(0.7, this.obstacleInterval - (this.distance / 2000));
        if (this.obstacleTimer >= dynamicObstacleInterval) {
            this.spawnObstacle();
            this.obstacleTimer = 0;
        }

        // 3. 백신 아이템 생성 조절
        this.vaccineTimer += deltaTime;
        if (this.vaccineTimer >= this.vaccineInterval) {
            this.spawnVaccine();
            this.vaccineTimer = 0;
        }

        // 4. 플레이어 업데이트
        this.player.update(deltaTime);

        // 5. 장애물 이동 및 충돌 판정 (AABB / 원거리 판정)
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const obs = this.obstacles[i];
            obs.update(deltaTime, this.currentSpeed);

            // 동일 레인 충돌 검사
            if (obs.lane === this.player.lane) {
                const distY = Math.abs(obs.y - this.player.y);
                if (distY < (obs.radius + this.player.height * 0.4)) {
                    // 4. 장애물 충돌 피격 효과음 재생
                    this.soundEngine.playObstacleSFX();

                    // 충돌 발생
                    const dead = this.player.takeDamage();
                    this.obstacles.splice(i, 1);
                    this.updateHUD();

                    if (dead) {
                        this.gameOver();
                        return;
                    }
                    continue;
                }
            }

            // 화면 밖으로 벗어난 장애물 제거 및 회피 점수 부여
            if (obs.y > CONFIG.CANVAS_HEIGHT + 50) {
                this.score += 20; // 회피 보너스
                this.obstacles.splice(i, 1);
            }
        }

        // 6. 백신 이동 및 획득 판정
        for (let i = this.vaccines.length - 1; i >= 0; i--) {
            const vac = this.vaccines[i];
            vac.update(deltaTime, this.currentSpeed);

            if (vac.lane === this.player.lane) {
                const distY = Math.abs(vac.y - this.player.y);
                if (distY < (vac.radius + this.player.height * 0.4)) {
                    // 3. 회복 효과음 재생
                    this.soundEngine.playHealSFX();

                    // 백신 획득!
                    this.player.heal();
                    this.vaccinesCollected++;
                    this.score += 100; // 백신 점수 보너스
                    this.vaccines.splice(i, 1);
                    this.updateHUD();
                    continue;
                }
            }

            if (vac.y > CONFIG.CANVAS_HEIGHT + 50) {
                this.vaccines.splice(i, 1);
            }
        }

        this.updateHUD();
    }

    /**
     * 메인 프레임 렌더링 로직
     */
    draw() {
        // 캔버스 초기화
        this.ctx.clearRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);

        // 배경 매트릭스 렌더링 (동적 레인 구분선 전달)
        this.bgStream.draw(this.ctx, this.laneCount);

        if ((this.state === 'PLAYING' || this.state === 'PAUSED') && this.player) {
            // 장애물 렌더링
            for (const obs of this.obstacles) {
                obs.draw(this.ctx);
            }

            // 백신 렌더링
            for (const vac of this.vaccines) {
                vac.draw(this.ctx);
            }

            // 플레이어 렌더링 (달리기/회복/피격 상태별 애니메이션 자산 맵 전달)
            this.player.draw(this.ctx, this.animImages);
        }

        // 일시 정지(PAUSED) 상태 시 반투명 오버레이 및 PAUSED 안내 텍스트 표시
        if (this.state === 'PAUSED') {
            this.ctx.save();
            this.ctx.fillStyle = 'rgba(4, 6, 16, 0.65)';
            this.ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);

            this.ctx.font = 'bold 36px Orbitron, sans-serif';
            this.ctx.fillStyle = '#00f0ff';
            this.ctx.shadowColor = '#00f0ff';
            this.ctx.shadowBlur = 15;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText('⏸️ GAME PAUSED', CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT / 2 - 20);

            this.ctx.font = '16px Orbitron, sans-serif';
            this.ctx.fillStyle = '#e0f7fc';
            this.ctx.shadowBlur = 0;
            this.ctx.fillText('설정 창에서 나와 게임을 재개하세요', CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT / 2 + 25);
            this.ctx.restore();
        }
    }

    /**
     * requestAnimationFrame 기반 게임 메인 루프
     * @param {number} timestamp 
     */
    startLoop() {
        const loop = (timestamp) => {
            if (!this.lastTime) this.lastTime = timestamp;
            const deltaTime = Math.min((timestamp - this.lastTime) / 1000, 0.1); // 최대 100ms 제한
            this.lastTime = timestamp;

            this.update(deltaTime);
            this.draw();

            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }
}

// DOM 로드 완료 후 게임 인스턴스 생성 및 시작
window.addEventListener('DOMContentLoaded', () => {
    try {
        window.gameInstance = new GameEngine();
    } catch (error) {
        console.error('게임 엔진 초기화 실패 원인:', error);
    }
});
