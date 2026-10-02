// === 전역 데이터 관리 ===
let rawData = [];
let selectedTeam = 'all';
let selectedQuadrant = 'all'; // 'all' | 'Q1' | 'Q2' | 'Q3' | 'Q4'
let periodType = 'month'; // 'month' | 'quarter' | 'year' | 'custom'
let selectedPeriod = '2026-08'; // '2026-08', '2026-Q3', '2026', or { start: '2026-01', end: '2026-08' }
let currentMonthDef = '2026-08'; // 호환성 유지용
let charts = {};

// 캘린더 피커 상태 관리
let pickerState = {
    isOpen: false,
    monthYear: 2026,
    quarterYear: 2026,
    customStartYear: 2026,
    customEndYear: 2026,
    customStart: '2026-01',
    customEnd: '2026-08'
};

let chartCompareType = 'mom'; // 'mom' | 'yoy'
let tableViewMode = 'partner'; // 'partner' | 'group'
let pieMode = 'region'; // 'region' (지역별 협력사 비중) | 'partner' (협력사별 지역 비중)
let pieTarget = 'all'; // 선택된 기준 지역 또는 협력사

let sortCol = '인원';
let sortDesc = true;

const DIVISION_CONFIG = [
    {
        division: "영업1본부",
        teams: ["동남아1팀", "동남아2팀", "동남아3팀"]
    },
    {
        division: "영업2본부",
        teams: ["일본팀", "중국팀"]
    },
    {
        division: "영업3본부",
        teams: ["서유럽팀", "스페인/북유럽팀", "동유럽팀", "지중해/인도/아프리카팀", "프리미엄팀"]
    },
    {
        division: "영업4본부",
        teams: ["미주팀", "남태평양팀", "부산지점", "대구지점"]
    },
    {
        division: "영업5본부",
        teams: ["크루즈/테마팀"]
    }
];
const TEAM_ORDER = DIVISION_CONFIG.flatMap(d => d.teams);

// 본부 이름에서 소속 팀 목록 반환
function getDivisionTeams(divisionName) {
    const found = DIVISION_CONFIG.find(d => d.division === divisionName);
    return found ? found.teams : [];
}

// selectedTeam이 본부 선택인지 확인 ('division:영업1본부' 형태)
function isDivisionSelected() {
    return selectedTeam && selectedTeam.startsWith('division:');
}

// selectedTeam에서 본부명 추출
function getSelectedDivisionName() {
    if (!isDivisionSelected()) return null;
    return selectedTeam.replace('division:', '');
}

/**
 * 본부 탭용: 다른 팀이 같은 (협력사 + 지역)을 공유할 때 중복 행을 합산
 * 하나의 (협력사, 지역) 조합으로 병합하며
 * 인당 지상비 = 합산 지상비 / 합산 인원 (가중평균)
 */
function mergeByPartnerRegion(dataArray) {
    const map = new Map();
    dataArray.forEach(d => {
        const key = `${d.협력사}___${d.지역}`;
        if (!map.has(key)) {
            map.set(key, {
                팀: d.팀,       // 첫 번째 팀명 보관 (참고용)
                협력사: d.협력사,
                지역: d.지역,
                인원: 0,
                지상비: 0,
                '인당 지상비': 0
            });
        }
        const item = map.get(key);
        item.인원 += (Number(d.인원) || 0);
        item.지상비 += (Number(d.지상비) || 0);
    });
    const result = Array.from(map.values());
    result.forEach(item => {
        // 인당 지상비 = 합산 지상비 / 합산 인원 (가중평균)
        item['인당 지상비'] = item.인원 > 0 ? Math.round(item.지상비 / item.인원) : 0;
    });
    return result;
}

async function fetchJsonSafe(url) {
    try {
        const cacheBuster = (url.includes('?') ? '&' : '?') + '_t=' + Date.now();
        let response = await fetch(url + cacheBuster, { cache: 'no-store' });
        if (!response.ok) {
            const encoded = encodeURI(url);
            if (encoded !== url) response = await fetch(encoded + cacheBuster, { cache: 'no-store' });
        }
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        return null;
    }
}

function preprocessData() {
    rawData = rawData.filter(d => (Number(d.인원) || 0) > 0);
    rawData.forEach(d => {
        if (d.팀 === '태국파트' || d.팀 === '필리핀/말레이시아파트') {
            d.팀 = '동남아3팀';
        }
        if (d['인당 지상비'] === undefined || d['인당 지상비'] === null || d['인당 지상비'] === '') {
            d['인당 지상비'] = (d['인원'] > 0) ? Math.round((d['지상비'] || 0) / d['인원']) : 0;
        } else {
            d['인당 지상비'] = Number(d['인당 지상비']) || 0;
        }
    });
}

// === 기간(월/분기/연도/직접설정) 유틸리티 함수 ===
const DATA_MIN_MONTH = '2023-01';
const DATA_MAX_MONTH = '2026-08';

function getAvailableMonths() {
    return [...new Set(rawData.map(d => d.월).filter(Boolean))].sort();
}

function getAvailableYears() {
    const months = getAvailableMonths();
    if (months.length === 0) return ['2023', '2024', '2025', '2026'];
    return [...new Set(months.map(m => m.split('-')[0]))].sort();
}

function shiftYear(ym, diffYears) {
    if (!ym || !ym.includes('-')) return null;
    const [y, m] = ym.split('-');
    return `${Number(y) + diffYears}-${m}`;
}

function getPeriodMonths(pType, pValue) {
    if (!pValue) return [];
    if (pType === 'month') {
        const ym = (typeof pValue === 'string') ? pValue : (pValue.start || '');
        return ym ? [ym] : [];
    } else if (pType === 'quarter') {
        const str = (typeof pValue === 'string') ? pValue : '';
        if (!str.includes('-Q')) return [];
        const [y, q] = str.split('-Q');
        if (q === '1') return [`${y}-01`, `${y}-02`, `${y}-03`];
        if (q === '2') return [`${y}-04`, `${y}-05`, `${y}-06`];
        if (q === '3') return [`${y}-07`, `${y}-08`, `${y}-09`];
        if (q === '4') return [`${y}-10`, `${y}-11`, `${y}-12`];
    } else if (pType === 'year') {
        const y = (typeof pValue === 'string') ? pValue : '';
        if (!y) return [];
        return Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
    } else if (pType === 'custom') {
        let start = '', end = '';
        if (typeof pValue === 'object' && pValue !== null) {
            start = pValue.start || '';
            end = pValue.end || '';
        } else if (typeof pValue === 'string') {
            const parts = pValue.split('~');
            start = parts[0]?.trim() || '';
            end = parts[1]?.trim() || start;
        }
        if (!start || !end) return [];
        if (start > end) {
            const tmp = start; start = end; end = tmp;
        }
        const [sy, sm] = start.split('-').map(Number);
        const [ey, em] = end.split('-').map(Number);
        const list = [];
        let curY = sy, curM = sm;
        while (curY < ey || (curY === ey && curM <= em)) {
            list.push(`${curY}-${String(curM).padStart(2, '0')}`);
            curM++;
            if (curM > 12) {
                curM = 1;
                curY++;
            }
        }
        return list;
    }
    return [];
}

function getComparisonPeriodKey(pType, pValue, compareType) {
    if (!pValue) return null;
    if (pType === 'month') {
        const ym = (typeof pValue === 'string') ? pValue : (pValue.start || '');
        if (!ym.includes('-')) return null;
        const [y, m] = ym.split('-').map(Number);
        if (compareType === 'mom') {
            let py = y, pm = m - 1;
            if (pm === 0) { pm = 12; py -= 1; }
            return `${py}-${pm.toString().padStart(2, '0')}`;
        } else if (compareType === 'yoy') {
            return `${y - 1}-${m.toString().padStart(2, '0')}`;
        }
    } else if (pType === 'quarter') {
        const str = (typeof pValue === 'string') ? pValue : '';
        if (!str.includes('-Q')) return null;
        const [yStr, qStr] = str.split('-Q');
        const y = Number(yStr), q = Number(qStr);
        if (compareType === 'mom') {
            let pq = q - 1, py = y;
            if (pq === 0) { pq = 4; py -= 1; }
            return `${py}-Q${pq}`;
        } else if (compareType === 'yoy') {
            return `${y - 1}-Q${q}`;
        }
    } else if (pType === 'year') {
        const y = Number(pValue);
        if (isNaN(y)) return null;
        if (compareType === 'mom') {
            return `${y - 1}`; // 전년
        } else if (compareType === 'yoy') {
            return `${y - 2}`; // 재작년
        }
    } else if (pType === 'custom') {
        let start = '', end = '';
        if (typeof pValue === 'object' && pValue !== null) {
            start = pValue.start || '';
            end = pValue.end || '';
        } else if (typeof pValue === 'string') {
            const parts = pValue.split('~');
            start = parts[0]?.trim() || '';
            end = parts[1]?.trim() || start;
        }
        if (!start || !end) return null;
        if (start > end) {
            const tmp = start; start = end; end = tmp;
        }
        const diffYears = (compareType === 'mom') ? -1 : -2;
        return {
            start: shiftYear(start, diffYears),
            end: shiftYear(end, diffYears)
        };
    }
    return null;
}

function getPeriodDisplayLabel(pType, pValue) {
    if (!pValue) return '';
    if (pType === 'month') {
        const ym = (typeof pValue === 'string') ? pValue : (pValue.start || '');
        if (ym && ym.includes('-')) {
            const [y, m] = ym.split('-');
            return `${y}년 ${m}월`;
        }
        return ym;
    } else if (pType === 'quarter') {
        const str = (typeof pValue === 'string') ? pValue : '';
        if (str && str.includes('-Q')) {
            const parts = str.split('-Q');
            return `${parts[0]}년 ${parts[1]}분기`;
        }
        return str;
    } else if (pType === 'year') {
        return `${pValue}년`;
    } else if (pType === 'custom') {
        let start = '', end = '';
        if (typeof pValue === 'object' && pValue !== null) {
            start = pValue.start || '';
            end = pValue.end || '';
        } else if (typeof pValue === 'string') {
            const parts = pValue.split('~');
            start = parts[0]?.trim() || '';
            end = parts[1]?.trim() || start;
        }
        if (!start || !end) return '';
        const [sy, sm] = start.split('-');
        const [ey, em] = end.split('-');
        return `${sy}년 ${sm}월 ~ ${ey}년 ${em}월`;
    }
    return String(pValue);
}

function getPeriodData(pType, pValue) {
    const targetMonths = getPeriodMonths(pType, pValue);
    if (!targetMonths || targetMonths.length === 0) return [];

    const matched = rawData.filter(d => targetMonths.includes(d.월));
    if (matched.length === 0) return [];

    // (팀, 협력사, 지역) 단위 합산
    const map = new Map();
    matched.forEach(d => {
        const team = d.팀 || '';
        const partner = d.협력사 || '';
        const region = d.지역 || '';
        const key = `${team}___${partner}___${region}`;
        if (!map.has(key)) {
            map.set(key, {
                팀: team,
                협력사: partner,
                지역: region,
                인원: 0,
                지상비: 0,
                '인당 지상비': 0
            });
        }
        const item = map.get(key);
        item.인원 += (Number(d.인원) || 0);
        item.지상비 += (Number(d.지상비) || 0);
    });

    const result = Array.from(map.values());
    result.forEach(item => {
        item['인당 지상비'] = item.인원 > 0 ? Math.round(item.지상비 / item.인원) : 0;
    });
    return result;
}

// === 캘린더 피커 UI 컨트롤 함수 ===
function updatePeriodDisplay() {
    const textEl = document.getElementById('periodDisplayText');
    if (!textEl) return;

    if (periodType === 'month') {
        const ym = (typeof selectedPeriod === 'string') ? selectedPeriod : (selectedPeriod?.start || '2026-08');
        const [y, m] = ym.split('-');
        textEl.innerText = `${y}년 ${m}월`;
    } else if (periodType === 'quarter') {
        const str = (typeof selectedPeriod === 'string') ? selectedPeriod : '2026-Q3';
        const [y, q] = str.split('-Q');
        textEl.innerText = `${y}년 ${q}분기`;
    } else if (periodType === 'year') {
        const y = (typeof selectedPeriod === 'string') ? selectedPeriod : '2026';
        textEl.innerText = `${y}년`;
    } else if (periodType === 'custom') {
        let start = '', end = '';
        if (typeof selectedPeriod === 'object' && selectedPeriod !== null) {
            start = selectedPeriod.start || '2026-01';
            end = selectedPeriod.end || '2026-08';
        } else if (typeof selectedPeriod === 'string') {
            const parts = selectedPeriod.split('~');
            start = parts[0]?.trim() || '2026-01';
            end = parts[1]?.trim() || '2026-08';
        }
        const [sy, sm] = start.split('-');
        const [ey, em] = end.split('-');
        textEl.innerText = `${sy}년 ${sm}월 ~ ${ey}년 ${em}월`;
    }
}

function togglePeriodPicker(forceState) {
    const popover = document.getElementById('periodPickerPopover');
    const btn = document.getElementById('periodDisplayBtn');
    if (!popover) return;

    const shouldOpen = (forceState !== undefined) ? forceState : !pickerState.isOpen;
    pickerState.isOpen = shouldOpen;

    if (shouldOpen) {
        renderPeriodPicker();
        popover.style.display = 'block';
        if (btn) btn.classList.add('open');
    } else {
        popover.style.display = 'none';
        if (btn) btn.classList.remove('open');
    }
}

function closePeriodPicker() {
    togglePeriodPicker(false);
}

function changePickerNavYear(type, delta) {
    if (type === 'month') {
        pickerState.monthYear = Math.max(2023, Math.min(2026, (pickerState.monthYear || 2026) + delta));
    } else if (type === 'quarter') {
        pickerState.quarterYear = Math.max(2023, Math.min(2026, (pickerState.quarterYear || 2026) + delta));
    }
    renderPeriodPicker();
}

function changeCustomNavYear(target, delta) {
    if (target === 'start') {
        pickerState.customStartYear = Math.max(2023, Math.min(2026, (pickerState.customStartYear || 2026) + delta));
    } else if (target === 'end') {
        pickerState.customEndYear = Math.max(2023, Math.min(2026, (pickerState.customEndYear || 2026) + delta));
    }
    renderPeriodPicker();
}

function selectMonthPeriod(ym) {
    selectedPeriod = ym;
    pickerState.monthYear = parseInt(ym.split('-')[0]);
    closePeriodPicker();
    updatePeriodDisplay();
    pieTarget = 'all';
    applyFilter();
}

function selectQuarterPeriod(qKey) {
    selectedPeriod = qKey;
    pickerState.quarterYear = parseInt(qKey.split('-Q')[0]);
    closePeriodPicker();
    updatePeriodDisplay();
    pieTarget = 'all';
    applyFilter();
}

function selectYearPeriod(yKey) {
    selectedPeriod = yKey;
    closePeriodPicker();
    updatePeriodDisplay();
    pieTarget = 'all';
    applyFilter();
}

function setCustomStart(ym) {
    pickerState.customStart = ym;
    if (pickerState.customEnd < ym) {
        pickerState.customEnd = ym;
        pickerState.customEndYear = parseInt(ym.split('-')[0]);
    }
    renderPeriodPicker();
}

function setCustomEnd(ym) {
    pickerState.customEnd = ym;
    if (pickerState.customStart > ym) {
        pickerState.customStart = ym;
        pickerState.customStartYear = parseInt(ym.split('-')[0]);
    }
    renderPeriodPicker();
}

function applyCustomPreset(preset) {
    const minM = DATA_MIN_MONTH;
    const maxM = DATA_MAX_MONTH;

    if (preset === '3m') {
        pickerState.customStart = '2026-06';
        pickerState.customEnd = '2026-08';
    } else if (preset === '6m') {
        pickerState.customStart = '2026-03';
        pickerState.customEnd = '2026-08';
    } else if (preset === '2024') {
        pickerState.customStart = '2024-01';
        pickerState.customEnd = '2024-12';
    } else if (preset === '2025') {
        pickerState.customStart = '2025-01';
        pickerState.customEnd = '2025-12';
    } else if (preset === '2026ytd') {
        pickerState.customStart = '2026-01';
        pickerState.customEnd = '2026-08';
    } else if (preset === 'all') {
        pickerState.customStart = minM;
        pickerState.customEnd = maxM;
    }

    pickerState.customStartYear = parseInt(pickerState.customStart.split('-')[0]);
    pickerState.customEndYear = parseInt(pickerState.customEnd.split('-')[0]);
    renderPeriodPicker();
}

function applyCustomPeriod() {
    let start = pickerState.customStart || '2026-01';
    let end = pickerState.customEnd || '2026-08';
    if (start > end) {
        const tmp = start; start = end; end = tmp;
    }
    selectedPeriod = { start, end };
    closePeriodPicker();
    updatePeriodDisplay();
    pieTarget = 'all';
    applyFilter();
}

function renderPeriodPicker() {
    const popover = document.getElementById('periodPickerPopover');
    if (!popover) return;

    const minMonth = DATA_MIN_MONTH;
    const maxMonth = DATA_MAX_MONTH;
    const minYear = 2023;
    const maxYear = 2026;

    if (periodType === 'month') {
        const currentSelected = (typeof selectedPeriod === 'string') ? selectedPeriod : (selectedPeriod?.start || '2026-08');
        const viewYear = pickerState.monthYear || parseInt(currentSelected.split('-')[0]) || 2026;

        let html = `
            <div class="cal-header">
                <div class="cal-year-nav">
                    <button type="button" class="cal-nav-btn" onclick="changePickerNavYear('month', -1)" ${viewYear <= minYear ? 'disabled' : ''}>◀</button>
                    <span class="cal-year-title">${viewYear}년</span>
                    <button type="button" class="cal-nav-btn" onclick="changePickerNavYear('month', 1)" ${viewYear >= maxYear ? 'disabled' : ''}>▶</button>
                </div>
                <span style="font-size:0.8rem; color:#64748b; font-weight:600;">월 선택 (단일 월 조회)</span>
            </div>
            <div class="cal-grid cal-grid-months">
        `;
        for (let m = 1; m <= 12; m++) {
            const mStr = String(m).padStart(2, '0');
            const ym = `${viewYear}-${mStr}`;
            const isDisabled = (ym < minMonth || ym > maxMonth);
            const isActive = (currentSelected === ym);
            html += `
                <button type="button" class="cal-cell-btn ${isActive ? 'active' : ''}" 
                    ${isDisabled ? 'disabled' : ''} 
                    onclick="selectMonthPeriod('${ym}')">
                    ${m}월
                </button>
            `;
        }
        html += `</div>`;
        popover.innerHTML = html;

    } else if (periodType === 'quarter') {
        const currentSelected = (typeof selectedPeriod === 'string') ? selectedPeriod : '2026-Q3';
        const viewYear = pickerState.quarterYear || (currentSelected.includes('-Q') ? parseInt(currentSelected.split('-Q')[0]) : 2026);

        let html = `
            <div class="cal-header">
                <div class="cal-year-nav">
                    <button type="button" class="cal-nav-btn" onclick="changePickerNavYear('quarter', -1)" ${viewYear <= minYear ? 'disabled' : ''}>◀</button>
                    <span class="cal-year-title">${viewYear}년</span>
                    <button type="button" class="cal-nav-btn" onclick="changePickerNavYear('quarter', 1)" ${viewYear >= maxYear ? 'disabled' : ''}>▶</button>
                </div>
                <span style="font-size:0.8rem; color:#64748b; font-weight:600;">분기 선택</span>
            </div>
            <div class="cal-grid cal-grid-quarters">
        `;
        const quarters = [
            { q: 1, label: '1분기 (1~3월)', start: `${viewYear}-01`, end: `${viewYear}-03` },
            { q: 2, label: '2분기 (4~6월)', start: `${viewYear}-04`, end: `${viewYear}-06` },
            { q: 3, label: '3분기 (7~9월)', start: `${viewYear}-07`, end: `${viewYear}-09` },
            { q: 4, label: '4분기 (10~12월)', start: `${viewYear}-10`, end: `${viewYear}-12` }
        ];
        quarters.forEach(item => {
            const qKey = `${viewYear}-Q${item.q}`;
            const isDisabled = (item.start > maxMonth || item.end < minMonth);
            const isActive = (currentSelected === qKey);
            html += `
                <button type="button" class="cal-cell-btn ${isActive ? 'active' : ''}" 
                    style="padding: 14px 10px; font-size: 0.95rem;"
                    ${isDisabled ? 'disabled' : ''} 
                    onclick="selectQuarterPeriod('${qKey}')">
                    ${item.label}
                </button>
            `;
        });
        html += `</div>`;
        popover.innerHTML = html;

    } else if (periodType === 'year') {
        const currentSelected = (typeof selectedPeriod === 'string') ? selectedPeriod : '2026';
        let html = `
            <div class="cal-header">
                <span class="cal-year-title" style="min-width:auto;">연도 선택</span>
                <span style="font-size:0.8rem; color:#64748b; font-weight:600;">조회할 연도를 선택하세요</span>
            </div>
            <div class="cal-grid cal-grid-years">
        `;
        for (let y = minYear; y <= maxYear; y++) {
            const yStr = String(y);
            const isActive = (currentSelected === yStr);
            const extra = (y === 2026) ? ' (1~8월)' : '';
            html += `
                <button type="button" class="cal-cell-btn ${isActive ? 'active' : ''}" 
                    style="padding: 16px 12px; font-size: 1rem;"
                    onclick="selectYearPeriod('${yStr}')">
                    ${y}년${extra}
                </button>
            `;
        }
        html += `</div>`;
        popover.innerHTML = html;

    } else if (periodType === 'custom') {
        let sMonth = pickerState.customStart || '2026-01';
        let eMonth = pickerState.customEnd || '2026-08';
        let sYear = pickerState.customStartYear || parseInt(sMonth.split('-')[0]) || 2026;
        let eYear = pickerState.customEndYear || parseInt(eMonth.split('-')[0]) || 2026;

        let html = `
            <div class="custom-range-container">
                <!-- 시작 연월 컬럼 -->
                <div class="custom-range-col">
                    <div class="custom-col-title">
                        <span>시작:</span>
                        <strong style="color:var(--accent-blue);">${sMonth.replace('-', '년 ')}월</strong>
                    </div>
                    <div class="cal-header" style="margin-bottom:8px; padding-bottom:6px;">
                        <div class="cal-year-nav" style="width:100%; justify-content:space-between;">
                            <button type="button" class="cal-nav-btn" onclick="changeCustomNavYear('start', -1)" ${sYear <= minYear ? 'disabled' : ''}>◀</button>
                            <span class="cal-year-title">${sYear}년</span>
                            <button type="button" class="cal-nav-btn" onclick="changeCustomNavYear('start', 1)" ${sYear >= maxYear ? 'disabled' : ''}>▶</button>
                        </div>
                    </div>
                    <div class="cal-grid cal-grid-months">
        `;
        for (let m = 1; m <= 12; m++) {
            const mStr = String(m).padStart(2, '0');
            const ym = `${sYear}-${mStr}`;
            const isDisabled = (ym < minMonth || ym > maxMonth);
            const isSelected = (sMonth === ym);
            const inRange = (ym >= sMonth && ym <= eMonth);
            html += `
                <button type="button" class="cal-cell-btn ${isSelected ? 'active' : (inRange ? 'in-range' : '')}" 
                    ${isDisabled ? 'disabled' : ''} 
                    onclick="setCustomStart('${ym}')">
                    ${m}월
                </button>
            `;
        }
        html += `
                    </div>
                </div>

                <div style="align-self:center; font-weight:800; color:#94a3b8; font-size:1.2rem; padding:0 2px;">~</div>

                <!-- 종료 연월 컬럼 -->
                <div class="custom-range-col">
                    <div class="custom-col-title">
                        <span>종료:</span>
                        <strong style="color:var(--accent-navy);">${eMonth.replace('-', '년 ')}월</strong>
                    </div>
                    <div class="cal-header" style="margin-bottom:8px; padding-bottom:6px;">
                        <div class="cal-year-nav" style="width:100%; justify-content:space-between;">
                            <button type="button" class="cal-nav-btn" onclick="changeCustomNavYear('end', -1)" ${eYear <= minYear ? 'disabled' : ''}>◀</button>
                            <span class="cal-year-title">${eYear}년</span>
                            <button type="button" class="cal-nav-btn" onclick="changeCustomNavYear('end', 1)" ${eYear >= maxYear ? 'disabled' : ''}>▶</button>
                        </div>
                    </div>
                    <div class="cal-grid cal-grid-months">
        `;
        for (let m = 1; m <= 12; m++) {
            const mStr = String(m).padStart(2, '0');
            const ym = `${eYear}-${mStr}`;
            const isDisabled = (ym < minMonth || ym > maxMonth);
            const isSelected = (eMonth === ym);
            const inRange = (ym >= sMonth && ym <= eMonth);
            html += `
                <button type="button" class="cal-cell-btn ${isSelected ? 'active' : (inRange ? 'in-range' : '')}" 
                    ${isDisabled ? 'disabled' : ''} 
                    onclick="setCustomEnd('${ym}')">
                    ${m}월
                </button>
            `;
        }
        html += `
                    </div>
                </div>
            </div>

            <!-- 하단 프리셋 및 적용 버튼 -->
            <div class="custom-range-footer">
                <div class="custom-presets">
                    <button type="button" class="preset-btn" onclick="applyCustomPreset('3m')">최근 3개월</button>
                    <button type="button" class="preset-btn" onclick="applyCustomPreset('6m')">최근 6개월</button>
                    <button type="button" class="preset-btn" onclick="applyCustomPreset('2024')">24년 전체</button>
                    <button type="button" class="preset-btn" onclick="applyCustomPreset('2025')">25년 전체</button>
                    <button type="button" class="preset-btn" onclick="applyCustomPreset('2026ytd')">26년 누적</button>
                    <button type="button" class="preset-btn" onclick="applyCustomPreset('all')">전체(23~26년)</button>
                </div>
                <button type="button" class="custom-apply-btn" onclick="applyCustomPeriod()">기간 적용</button>
            </div>
        `;
        popover.innerHTML = html;
    }
}

// 전역 바인딩
window.changePickerNavYear = changePickerNavYear;
window.changeCustomNavYear = changeCustomNavYear;
window.selectMonthPeriod = selectMonthPeriod;
window.selectQuarterPeriod = selectQuarterPeriod;
window.selectYearPeriod = selectYearPeriod;
window.setCustomStart = setCustomStart;
window.setCustomEnd = setCustomEnd;
window.applyCustomPreset = applyCustomPreset;
window.applyCustomPeriod = applyCustomPeriod;

async function loadData() {
    try {
        let manifest = await fetchJsonSafe('./data/index.json');
        if (!manifest) manifest = await fetchJsonSafe('./index.json');

        // 혹시 index.json 로드가 실패했거나 파일이 44개 미만인 경우 전체 목록 자동 구성
        const allMonths = [];
        for (let y = 23; y <= 26; y++) {
            const maxM = (y === 26) ? 8 : 12;
            for (let m = 1; m <= maxM; m++) {
                const mm = String(m).padStart(2, '0');
                allMonths.push({
                    label: `20${y}-${mm}`,
                    file: `data_${y}_${mm}.json`
                });
            }
        }

        const entriesToLoad = (manifest && Array.isArray(manifest) && manifest.length >= 44) ? manifest : allMonths;

        rawData = [];
        for (const entry of entriesToLoad) {
            if (!entry || !entry.file) continue;
            let fileData = await fetchJsonSafe(`./data/${entry.file}`);
            if (!fileData) fileData = await fetchJsonSafe(`./${entry.file}`);
            if (fileData && Array.isArray(fileData) && fileData.length > 0) {
                fileData.forEach(d => { d.월 = entry.label; });
                rawData = rawData.concat(fileData);
            }
        }

        if (rawData.length === 0) throw new Error('데이터 로드 실패');

        preprocessData();

        // 최신 월 기준 초기화
        const months = getAvailableMonths();
        const latestMonth = months.length > 0 ? months[months.length - 1] : '2026-08';
        selectedPeriod = latestMonth;
        pickerState.customStart = '2026-01';
        pickerState.customEnd = latestMonth;

        initSidebar();
        initCharts();
        setupEventListeners();
        updatePeriodDisplay();

        setTimeout(() => {
            Object.values(charts).forEach(c => c && c.resize());
            applyFilter();
            setTimeout(() => Object.values(charts).forEach(c => c && c.resize()), 150);
        }, 50);

        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => {
                Object.values(charts).forEach(c => c && c.resize());
            });
            document.querySelectorAll('#chart1, #chart2, #pieChart').forEach(el => ro.observe(el));
        }

    } catch (err) {
        console.error('데이터 로드 실패:', err);
    }
}

document.addEventListener('DOMContentLoaded', loadData);

function initSidebar() {
    const teamNav = document.getElementById('teamNav');
    teamNav.innerHTML = '';

    const allLi = document.createElement('li');
    allLi.className = 'nav-item' + (selectedTeam === 'all' ? ' active' : '');
    allLi.dataset.team = 'all';
    allLi.innerHTML = `<span>전체</span>`;
    allLi.addEventListener('click', (e) => changeTeam('all', e.currentTarget));
    teamNav.appendChild(allLi);

    DIVISION_CONFIG.forEach(div => {
        // 본부 헤더를 클릭 가능한 탭으로 변경
        const divKey = `division:${div.division}`;
        const divLi = document.createElement('li');
        divLi.className = 'nav-item nav-division-tab' + (selectedTeam === divKey ? ' active' : '');
        divLi.dataset.team = divKey;
        divLi.innerHTML = `<span class="nav-division-icon">🏢</span><span>${div.division}</span>`;
        divLi.addEventListener('click', (e) => changeTeam(divKey, e.currentTarget));
        teamNav.appendChild(divLi);

        div.teams.forEach(t => {
            const li = document.createElement('li');
            li.className = 'nav-item nav-sub-item' + (selectedTeam === t ? ' active' : '');
            li.dataset.team = t;
            li.innerHTML = `<span>${t}</span>`;
            li.addEventListener('click', (e) => changeTeam(t, e.currentTarget));
            teamNav.appendChild(li);
        });
    });
}

function changeTeam(tName, el) {
    selectedTeam = tName;
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
    let titleText;
    if (tName === 'all') {
        titleText = '전체 현황';
    } else if (tName.startsWith('division:')) {
        titleText = tName.replace('division:', '') + ' 현황';
    } else {
        titleText = tName;
    }
    document.getElementById('currentTeamTitle').innerText = titleText;
    pieTarget = 'all';
    applyFilter();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setupEventListeners() {
    // 기간 구분 토글 버튼 (월별 / 분기별 / 연도별 / 직접설정)
    document.querySelectorAll('#periodTypeToggles .toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const newType = e.target.dataset.period;
            if (periodType === newType) return;
            periodType = newType;
            document.querySelectorAll('#periodTypeToggles .toggle-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.period === periodType);
            });

            // 모드 전환 시 기본값 설정
            const months = getAvailableMonths();
            const latestMonth = months.length > 0 ? months[months.length - 1] : '2026-08';
            if (periodType === 'month') {
                selectedPeriod = latestMonth;
                pickerState.monthYear = parseInt(latestMonth.split('-')[0]);
            } else if (periodType === 'quarter') {
                const [y, m] = latestMonth.split('-').map(Number);
                const q = Math.ceil(m / 3);
                selectedPeriod = `${y}-Q${q}`;
                pickerState.quarterYear = y;
            } else if (periodType === 'year') {
                selectedPeriod = latestMonth.split('-')[0];
            } else if (periodType === 'custom') {
                selectedPeriod = {
                    start: pickerState.customStart || '2026-01',
                    end: pickerState.customEnd || latestMonth
                };
            }

            updatePeriodDisplay();
            pieTarget = 'all';
            applyFilter();
            if (pickerState.isOpen) {
                renderPeriodPicker();
            }
        });
    });

    // 기간 디스플레이 버튼 클릭 시 캘린더 팝오버 열기/닫기
    const periodDisplayBtn = document.getElementById('periodDisplayBtn');
    if (periodDisplayBtn) {
        periodDisplayBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePeriodPicker();
        });
    }

    // 팝오버 내부 클릭 시 이벤트 버블링 차단 (년도 변경/프리셋 클릭 시 innerHTML 교체로 인한 팝업 꺼짐 방지)
    const periodPickerPopover = document.getElementById('periodPickerPopover');
    if (periodPickerPopover) {
        periodPickerPopover.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    // 외부 클릭 시 캘린더 피커 닫기 (방금 DOM에서 제거된 내부 요소 클릭은 제외)
    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('periodPickerWrapper');
        if (wrapper && !wrapper.contains(e.target) && document.body.contains(e.target)) {
            closePeriodPicker();
        }
    });

    // ESC 키로 캘린더 닫기
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closePeriodPicker();
    });

    window.addEventListener('resize', () => { Object.values(charts).forEach(c => c && c.resize()); });

    document.querySelectorAll('#globalCompareToggles .toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            chartCompareType = e.target.dataset.type;
            document.querySelectorAll('#globalCompareToggles .toggle-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.type === chartCompareType);
            });
            applyFilter();
        });
    });

    document.querySelectorAll('#pieModeToggles .toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            pieMode = e.target.dataset.mode;
            document.querySelectorAll('#pieModeToggles .toggle-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.mode === pieMode);
            });
            pieTarget = 'all';
            applyFilter();
        });
    });

    const pieSelect = document.getElementById('pieTargetSelect');
    if (pieSelect) {
        pieSelect.addEventListener('change', (e) => {
            pieTarget = e.target.value;
            const baseCurr = getPeriodData(periodType, selectedPeriod);
            let currTarget;
            const divName = getSelectedDivisionName();
            if (selectedTeam === 'all') {
                currTarget = baseCurr;
            } else if (divName) {
                const divTeams = getDivisionTeams(divName);
                const divFiltered = baseCurr.filter(d => divTeams.includes(d.팀));
                // 본부 탭: (협력사, 지역) 기준 중복 합산
                currTarget = mergeByPartnerRegion(divFiltered);
            } else {
                currTarget = baseCurr.filter(d => d.팀 === selectedTeam);
            }
            updatePieChart(currTarget);
        });
    }

    const btnPartner = document.getElementById('viewModePartner');
    const btnGroup = document.getElementById('viewModeGroup');

    if (btnPartner) {
        btnPartner.addEventListener('click', () => {
            tableViewMode = 'partner';
            btnPartner.classList.add('active');
            if (btnGroup) btnGroup.classList.remove('active');
            applyFilter();
        });
    }
    if (btnGroup) {
        btnGroup.addEventListener('click', () => {
            tableViewMode = 'group';
            btnGroup.classList.add('active');
            if (btnPartner) btnPartner.classList.remove('active');
            applyFilter();
        });
    }

    document.querySelectorAll('.quadrant-card-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const q = btn.dataset.quadrant;
            if (selectedQuadrant === q) {
                selectedQuadrant = 'all';
            } else {
                selectedQuadrant = q;
            }
            applyFilter();
        });
    });
}

const formatNum = (num) => new Intl.NumberFormat('ko-KR').format(num);

function getTrendHTML(curr, prev, unit = '') {
    if (prev === null || prev === undefined || prev === 0) return `<span class="trend-neutral">- 비교 데이터 없음</span>`;
    const diff = curr - prev;
    const rate = ((diff / prev) * 100).toFixed(1);
    if (diff > 0) return `<span class="trend-up">▲ ${formatNum(diff)}${unit} (+${rate}%)</span>`;
    if (diff < 0) return `<span class="trend-down">▼ ${formatNum(Math.abs(diff))}${unit} (${rate}%)</span>`;
    return `<span class="trend-neutral">- 변동 없음 (0.0%)</span>`;
}

function applyFilter() {
    document.querySelectorAll('.quadrant-card-btn').forEach(btn => {
        const q = btn.dataset.quadrant;
        btn.classList.toggle('active', selectedQuadrant === q);
    });

    // 기간 모드에 따른 비교 버튼 및 레이블 갱신 (요구사항 4번)
    const momBtn = document.querySelector('#globalCompareToggles [data-type="mom"]');
    const yoyBtn = document.querySelector('#globalCompareToggles [data-type="yoy"]');
    if (momBtn && yoyBtn) {
        momBtn.style.display = '';
        yoyBtn.style.display = '';
        if (periodType === 'month') {
            momBtn.innerText = '전월';
            yoyBtn.innerText = '전년 동월';
        } else if (periodType === 'quarter') {
            momBtn.innerText = '전분기';
            yoyBtn.innerText = '전년 동분기';
        } else if (periodType === 'year') {
            momBtn.innerText = '전년';
            yoyBtn.innerText = '재작년';
        } else if (periodType === 'custom') {
            momBtn.innerText = '전년 동시점';
            yoyBtn.innerText = '전전년도 동시점';
        }
    }

    let pLabelSuffix = '당월';
    let momTrendLabel = '전월 대비';
    let yoyTrendLabel = '전년 동월 대비';

    if (periodType === 'quarter') {
        pLabelSuffix = '당분기';
        momTrendLabel = '전분기 대비';
        yoyTrendLabel = '전년 동분기 대비';
    } else if (periodType === 'year') {
        pLabelSuffix = '연간';
        momTrendLabel = '전년 대비';
        yoyTrendLabel = '재작년 대비';
    } else if (periodType === 'custom') {
        pLabelSuffix = '선택기간';
        momTrendLabel = '전년 동시점 대비';
        yoyTrendLabel = '전전년도 동시점 대비';
    }

    const kpiPTitle = document.getElementById('kpiPersonnelTitle');
    if (kpiPTitle) kpiPTitle.innerText = `${pLabelSuffix} 송출 인원`;

    const kpiCTitle = document.getElementById('kpiCostTitle');
    if (kpiCTitle) kpiCTitle.innerText = `${pLabelSuffix} 총 지상비 (비용)`;

    // 본부 선택 여부 판단
    const divisionName = getSelectedDivisionName();
    const divisionTeams = divisionName ? getDivisionTeams(divisionName) : [];

    const kpiAvgCostTitle = document.getElementById('kpiAvgCostTitle');
    if (kpiAvgCostTitle) {
        if (selectedTeam === 'all') {
            kpiAvgCostTitle.innerText = `${pLabelSuffix} 평균 인당 지상비 (전체)`;
        } else if (divisionName) {
            kpiAvgCostTitle.innerText = `${pLabelSuffix} 평균 인당 지상비 (${divisionName})`;
        } else {
            kpiAvgCostTitle.innerText = `${pLabelSuffix} 평균 인당 지상비 (${selectedTeam})`;
        }
    }

    // 비교 섹션 레이블 업데이트
    const compareSectionLabel = document.getElementById('compareSectionLabel');
    if (compareSectionLabel) {
        if (selectedTeam === 'all') {
            compareSectionLabel.innerText = '팀별 비교';
        } else if (divisionName) {
            compareSectionLabel.innerText = `${divisionName} 소속 팀별 비교`;
        } else {
            compareSectionLabel.innerText = '협력사/지역별 비교';
        }
    }

    document.querySelectorAll('.kpi-card .kpi-trend-item').forEach(item => {
        const lbl = item.querySelector('.trend-label');
        const valSpan = item.querySelector('.trend-val');
        if (!lbl || !valSpan) return;
        if (valSpan.id.includes('Mom')) {
            lbl.innerText = momTrendLabel;
            item.style.display = '';
        } else if (valSpan.id.includes('Yoy')) {
            lbl.innerText = yoyTrendLabel;
            item.style.display = '';
        }
    });

    const chartCompareKey = getComparisonPeriodKey(periodType, selectedPeriod, chartCompareType);
    const kpiMomKey = getComparisonPeriodKey(periodType, selectedPeriod, 'mom');
    const kpiYoyKey = getComparisonPeriodKey(periodType, selectedPeriod, 'yoy');

    const currPeriodLabel = getPeriodDisplayLabel(periodType, selectedPeriod);
    const chartCompareLabel = chartCompareKey ? getPeriodDisplayLabel(periodType, chartCompareKey) : '비교 없음';

    const baseCurr = getPeriodData(periodType, selectedPeriod);
    const baseChartPrev = chartCompareKey ? getPeriodData(periodType, chartCompareKey) : [];
    const baseKpiMom = kpiMomKey ? getPeriodData(periodType, kpiMomKey) : [];
    const baseKpiYoy = kpiYoyKey ? getPeriodData(periodType, kpiYoyKey) : [];

    // 데이터 필터링: 전체 / 본부 / 팀 구분
    let currTarget, chartPrevTarget, kpiMomTarget, kpiYoyTarget;
    if (selectedTeam === 'all') {
        currTarget = baseCurr;
        chartPrevTarget = baseChartPrev;
        kpiMomTarget = baseKpiMom;
        kpiYoyTarget = baseKpiYoy;
    } else if (divisionName) {
        // 본부 선택: 소속 팀 전체 데이터 취합
        currTarget = baseCurr.filter(d => divisionTeams.includes(d.팀));
        chartPrevTarget = baseChartPrev.filter(d => divisionTeams.includes(d.팀));
        kpiMomTarget = baseKpiMom.filter(d => divisionTeams.includes(d.팀));
        kpiYoyTarget = baseKpiYoy.filter(d => divisionTeams.includes(d.팀));
    } else {
        // 단일 팀 선택
        currTarget = baseCurr.filter(d => d.팀 === selectedTeam);
        chartPrevTarget = baseChartPrev.filter(d => d.팀 === selectedTeam);
        kpiMomTarget = baseKpiMom.filter(d => d.팀 === selectedTeam);
        kpiYoyTarget = baseKpiYoy.filter(d => d.팀 === selectedTeam);
    }

    const sumP_curr = currTarget.reduce((s, d) => s + (d.인원 || 0), 0);
    const sumC_curr = currTarget.reduce((s, d) => s + (d.지상비 || 0), 0);
    const avgCost_curr = sumP_curr > 0 ? Math.round(sumC_curr / sumP_curr) : 0;

    const hasMomData = kpiMomTarget.length > 0;
    const sumP_mom = hasMomData ? kpiMomTarget.reduce((s, d) => s + (d.인원 || 0), 0) : null;
    const sumC_mom = hasMomData ? kpiMomTarget.reduce((s, d) => s + (d.지상비 || 0), 0) : null;
    const avgCost_mom = (hasMomData && sumP_mom > 0) ? Math.round(sumC_mom / sumP_mom) : null;

    const hasYoyData = kpiYoyTarget.length > 0;
    const sumP_yoy = hasYoyData ? kpiYoyTarget.reduce((s, d) => s + (d.인원 || 0), 0) : null;
    const sumC_yoy = hasYoyData ? kpiYoyTarget.reduce((s, d) => s + (d.지상비 || 0), 0) : null;
    const avgCost_yoy = (hasYoyData && sumP_yoy > 0) ? Math.round(sumC_yoy / sumP_yoy) : null;

    document.getElementById('kpiPersonnelCurrent').innerText = formatNum(sumP_curr);
    document.getElementById('kpiPersonnelTrendMom').innerHTML = getTrendHTML(sumP_curr, sumP_mom, '명');
    document.getElementById('kpiPersonnelTrendYoy').innerHTML = getTrendHTML(sumP_curr, sumP_yoy, '명');

    document.getElementById('kpiCostCurrent').innerText = formatNum(sumC_curr);
    document.getElementById('kpiCostTrendMom').innerHTML = getTrendHTML(sumC_curr, sumC_mom, '원');
    document.getElementById('kpiCostTrendYoy').innerHTML = getTrendHTML(sumC_curr, sumC_yoy, '원');

    document.getElementById('kpiAvgCostCurrent').innerText = formatNum(avgCost_curr);
    document.getElementById('kpiAvgCostTrendMom').innerHTML = getTrendHTML(avgCost_curr, avgCost_mom, '원');
    document.getElementById('kpiAvgCostTrendYoy').innerHTML = getTrendHTML(avgCost_curr, avgCost_yoy, '원');

    if (selectedTeam === 'all' || divisionName) {
        // 전체 또는 본부 선택: 팀별 비교 차트
        updateAllCharts(currTarget, chartPrevTarget, chartCompareLabel, currPeriodLabel, pLabelSuffix, divisionName || null);
    } else {
        // 단일 팀: 협력사/지역별 차트
        updateTeamCharts(currTarget, chartPrevTarget, chartCompareLabel, currPeriodLabel, pLabelSuffix);
    }

    // 본부 탭일 때: (협력사, 지역) 기준으로 중복 행 합산
    // 다른 팀이 같은 협력사+지역 사용 시 파이차트/테이블에서 중복 로우 방지
    const pieTableTarget = divisionName ? mergeByPartnerRegion(currTarget) : currTarget;
    const pieTableBase = divisionName ? mergeByPartnerRegion(baseCurr.filter(d => divisionTeams.includes(d.팀))) : baseCurr;

    updatePieChart(pieTableTarget);
    renderTable(pieTableTarget, pieTableBase);
}

function initCharts() {
    charts.chart1 = echarts.init(document.getElementById('chart1'));
    const chart2El = document.getElementById('chart2');
    if (chart2El) charts.chart2 = echarts.init(chart2El);
    const pieEl = document.getElementById('pieChart');
    if (pieEl) charts.pieChart = echarts.init(pieEl);
    window.addEventListener('resize', () => {
        Object.values(charts).forEach(c => c && c.resize());
    });
}

function formatCompactWon(val) {
    if (!val || val === 0) return '';
    if (val >= 100000000) {
        const v = (val / 100000000).toFixed(1);
        return (v.endsWith('.0') ? v.slice(0, -2) : v) + '억';
    }
    if (val >= 10000000) {
        return Math.round(val / 10000000) + '천만';
    }
    if (val >= 1000000) {
        return Math.round(val / 1000000) + '백만';
    }
    return formatNum(val);
}

function updateAllCharts(currArray, prevArray, prevNameStr, currNameStr, currSuffix, divisionLabel) {
    const c1t = document.getElementById('chart1Title');
    if (c1t) c1t.innerText = divisionLabel ? `${divisionLabel} 소속 팀별 송출 인원 비교` : `팀별 송출 인원 비교`;
    const c2t = document.getElementById('chart2Title');
    if (c2t) c2t.innerText = divisionLabel ? `${divisionLabel} 소속 팀별 지상비 비교` : `팀별 지상비 비교`;

    const aggregate = (dataArr) => {
        const result = {};
        dataArr.forEach(d => {
            if (!result[d.팀]) result[d.팀] = { 인원: 0, 비용: 0 };
            result[d.팀].인원 += (Number(d.인원) || 0); result[d.팀].비용 += (Number(d.지상비) || 0);
        });
        return result;
    };
    const cMap = aggregate(currArray);
    const pMap = aggregate(prevArray);
    const uniqueKeys = TEAM_ORDER.filter(t => cMap[t] || pMap[t]);

    const persCurrS = uniqueKeys.map(k => cMap[k]?.인원 || 0);
    const persPrevS = uniqueKeys.map(k => pMap[k]?.인원 || 0);
    const costCurrS = uniqueKeys.map(k => cMap[k]?.비용 || 0);
    const costPrevS = uniqueKeys.map(k => pMap[k]?.비용 || 0);

    const prevLegend = prevNameStr || '비교 없음';
    const currLegend = currNameStr || '당기';
    const periodSuffix = currSuffix || '당기';

    const setGroupChart = (chartInstance, prevS, currS, field, currGradient) => {
        if (!chartInstance) return;
        if (uniqueKeys.length === 0) {
            chartInstance.clear();
            chartInstance.setOption({
                title: {
                    text: '선택된 기간에 조회된 데이터가 없습니다.',
                    left: 'center',
                    top: 'middle',
                    textStyle: { color: '#94a3b8', fontSize: 14, fontWeight: 500, fontFamily: 'Pretendard, sans-serif' }
                }
            });
            return;
        }

        const unit = (field === '인원') ? '명' : '원';
        const needsZoom = uniqueKeys.length > 9;

        chartInstance.setOption({
            textStyle: { fontFamily: 'Pretendard, sans-serif' },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                backgroundColor: 'rgba(255, 255, 255, 0.98)',
                borderColor: '#cbd5e1',
                borderWidth: 1,
                padding: [12, 16],
                textStyle: { color: '#1e293b', fontSize: 12, fontFamily: 'Pretendard, sans-serif' },
                extraCssText: 'box-shadow: 0 10px 25px rgba(0,0,0,0.12); border-radius: 12px; min-width: 220px;',
                formatter: function (params) {
                    if (!params || !params.length) return '';
                    const teamName = params[0].axisValue;
                    const prevVal = params[0]?.value || 0;
                    const currVal = params[1]?.value || 0;
                    const diff = currVal - prevVal;
                    const rate = prevVal > 0 ? ((diff / prevVal) * 100).toFixed(1) + '%' : (currVal > 0 ? '신규' : '0%');
                    const diffColor = diff > 0 ? '#16a34a' : (diff < 0 ? '#dc2626' : '#64748b');
                    const diffSign = diff > 0 ? '+' : '';

                    return `<div style="font-weight:800; font-size:14px; margin-bottom:8px; color:#0f172a; border-bottom:1.5px solid #e2e8f0; padding-bottom:6px;">📊 ${teamName}</div>
                        <div style="display:flex; justify-content:space-between; gap:16px; margin-bottom:4px; font-size:12px;">
                            <span style="color:#64748b;">${prevLegend} (이전):</span>
                            <strong style="color:#475569;">${formatNum(prevVal)} ${unit}</strong>
                        </div>
                        <div style="display:flex; justify-content:space-between; gap:16px; margin-bottom:6px; font-size:12px;">
                            <span style="color:${field === '인원' ? '#2563eb' : '#7c3aed'}; font-weight:700;">${currLegend} (${periodSuffix}):</span>
                            <strong style="color:#0f172a;">${formatNum(currVal)} ${unit}</strong>
                        </div>
                        <div style="display:flex; justify-content:space-between; gap:16px; padding-top:4px; border-top:1px dashed #e2e8f0; font-size:12px;">
                            <span style="color:#64748b;">증감:</span>
                            <strong style="color:${diffColor};">${diffSign}${formatNum(diff)} ${unit} (${diffSign}${rate})</strong>
                        </div>`;
                }
            },
            legend: {
                data: [`${prevLegend} (이전)`, `${currLegend} (${periodSuffix})`],
                orient: 'vertical',
                top: -8,
                right: 12,
                itemGap: 7,
                itemWidth: 12,
                itemHeight: 12,
                textStyle: { color: '#475569', fontSize: 11.5, fontWeight: 600, fontFamily: 'Pretendard, sans-serif' }
            },
            grid: { left: '3%', right: '4%', top: '55px', bottom: needsZoom ? '65px' : '45px', containLabel: true },
            barCategoryGap: '40%',
            xAxis: {
                type: 'category',
                data: uniqueKeys,
                axisLabel: { color: '#1e293b', fontSize: 12, fontWeight: 600, interval: 0, rotate: 0, margin: 12, fontFamily: 'Pretendard, sans-serif' },
                axisLine: { lineStyle: { color: '#cbd5e1' } }
            },
            yAxis: {
                type: 'value',
                axisLabel: { color: '#64748b', fontSize: 11, fontFamily: 'Pretendard, sans-serif', formatter: val => field === '지상비' ? formatCompactWon(val) : formatNum(val) },
                splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)' } }
            },
            dataZoom: needsZoom ? [
                {
                    type: 'slider',
                    show: true,
                    xAxisIndex: [0],
                    bottom: 8,
                    height: 24,
                    startValue: 0,
                    endValue: Math.min(uniqueKeys.length - 1, 8),
                    fillerColor: field === '인원' ? 'rgba(37, 99, 235, 0.15)' : 'rgba(124, 58, 237, 0.15)',
                    borderColor: '#cbd5e1',
                    handleStyle: { color: field === '인원' ? '#2563eb' : '#7c3aed' },
                    textStyle: { color: '#64748b', fontSize: 11, fontWeight: 600, fontFamily: 'Pretendard, sans-serif' },
                    brushSelect: false,
                    showDetail: true
                },
                { type: 'inside', xAxisIndex: [0], zoomOnMouseWheel: false, moveOnMouseMove: true }
            ] : [],
            series: [
                {
                    name: `${prevLegend} (이전)`,
                    type: 'bar',
                    barGap: '12%',
                    barMaxWidth: 36,
                    itemStyle: {
                        color: '#94a3b8',
                        borderColor: '#64748b',
                        borderWidth: 1.2,
                        borderRadius: [3, 3, 0, 0]
                    },
                    data: prevS.map((val, idx) => {
                        if (!val || val <= 0) return { value: 0, label: { show: false } };
                        return {
                            value: val,
                            label: {
                                show: true,
                                position: 'top',
                                color: '#64748b',
                                fontSize: 11,
                                fontWeight: 700,
                                fontFamily: 'Pretendard, sans-serif',
                                formatter: p => { const v = (p && typeof p === 'object' && p.value !== undefined) ? p.value : p; return field === '지상비' ? formatCompactWon(v) : formatNum(v); }
                            }
                        };
                    })
                },
                {
                    name: `${currLegend} (${periodSuffix})`,
                    type: 'bar',
                    barMaxWidth: 36,
                    itemStyle: {
                        color: currGradient,
                        borderRadius: [3, 3, 0, 0]
                    },
                    data: currS.map((val, idx) => {
                        if (!val || val <= 0) return { value: 0, label: { show: false } };
                        const prevVal = prevS[idx] || 0;
                        const diff = val - prevVal;
                        const rate = prevVal > 0 ? ((diff / prevVal) * 100).toFixed(0) + '%' : '';
                        const tag = prevVal > 0 ? (diff > 0 ? `▲+${rate}` : diff < 0 ? `▼${rate}` : `-`) : '';
                        const tagColor = diff > 0 ? '#16a34a' : (diff < 0 ? '#dc2626' : '#64748b');

                        return {
                            value: val,
                            label: {
                                show: true,
                                position: 'top',
                                color: field === '인원' ? '#1d4ed8' : '#6b21a8',
                                fontSize: 11.5,
                                fontWeight: 800,
                                fontFamily: 'Pretendard, sans-serif',
                                formatter: (p) => {
                                    const v = (p && typeof p === 'object' && p.value !== undefined) ? p.value : p;
                                    const baseStr = (field === '지상비' ? formatCompactWon(v) : formatNum(v));
                                    return tag ? `${baseStr}\n{tag|${tag}}` : baseStr;
                                },
                                rich: {
                                    tag: {
                                        color: tagColor,
                                        fontSize: 10,
                                        fontWeight: 800,
                                        lineHeight: 14,
                                        align: 'center'
                                    }
                                }
                            }
                        };
                    })
                }
            ]
        }, true);

        requestAnimationFrame(() => {
            chartInstance.resize();
            setTimeout(() => chartInstance.resize(), 100);
        });
    };

    setGroupChart(charts.chart1, persPrevS, persCurrS, '인원', new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#38bdf8' }, { offset: 1, color: '#1d4ed8' }]));
    if (charts.chart2) setGroupChart(charts.chart2, costPrevS, costCurrS, '지상비', new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#c084fc' }, { offset: 1, color: '#6b21a8' }]));
}

function updateTeamCharts(currArray, prevArray, prevNameStr, currNameStr, currSuffix) {
    const c1t = document.getElementById('chart1Title');
    if (c1t) c1t.innerText = `협력사/지역별 송출 인원 비교`;
    const c2t = document.getElementById('chart2Title');
    if (c2t) c2t.innerText = `협력사/지역별 지상비 비교`;

    const partners = [...new Set([...currArray, ...prevArray].map(d => d.협력사))];
    const partnerTotal = {};
    currArray.forEach(d => { partnerTotal[d.협력사] = (partnerTotal[d.협력사] || 0) + d.인원; });
    partners.sort((a, b) => (partnerTotal[b] || 0) - (partnerTotal[a] || 0));

    const regions = [...new Set([...currArray, ...prevArray].map(d => d.지역))];
    const prevLegend = prevNameStr || '비교 없음';
    const currLegend = currNameStr || '당기';
    const periodSuffix = currSuffix || '당기';

    const blueShades = [
        { bg: '#1e3a8a', text: '#ffffff' },
        { bg: '#1d4ed8', text: '#ffffff' },
        { bg: '#2563eb', text: '#ffffff' },
        { bg: '#3b82f6', text: '#ffffff' },
        { bg: '#0ea5e9', text: '#ffffff' },
        { bg: '#38bdf8', text: '#0f172a' },
        { bg: '#7dd3fc', text: '#0f172a' },
        { bg: '#bae6fd', text: '#0f172a' },
        { bg: '#e0f2fe', text: '#0f172a' }
    ];

    const purpleShades = [
        { bg: '#3b0764', text: '#ffffff' },
        { bg: '#581c87', text: '#ffffff' },
        { bg: '#6b21a8', text: '#ffffff' },
        { bg: '#7c3aed', text: '#ffffff' },
        { bg: '#9333ea', text: '#ffffff' },
        { bg: '#a855f7', text: '#ffffff' },
        { bg: '#c084fc', text: '#0f172a' },
        { bg: '#e9d5ff', text: '#0f172a' },
        { bg: '#f3e8ff', text: '#0f172a' }
    ];

    const grayShades = [
        { bg: '#334155', text: '#ffffff' },
        { bg: '#475569', text: '#ffffff' },
        { bg: '#64748b', text: '#ffffff' },
        { bg: '#94a3b8', text: '#0f172a' },
        { bg: '#cbd5e1', text: '#0f172a' },
        { bg: '#e2e8f0', text: '#0f172a' },
        { bg: '#f1f5f9', text: '#0f172a' }
    ];

    const setStackedChart = (chartInstance, dataField) => {
        if (!chartInstance) return;
        if (partners.length === 0) {
            chartInstance.clear();
            chartInstance.setOption({
                title: {
                    text: '선택된 기간에 조회된 데이터가 없습니다.',
                    left: 'center',
                    top: 'middle',
                    textStyle: { color: '#94a3b8', fontSize: 14, fontWeight: 500, fontFamily: 'Pretendard, sans-serif' }
                }
            });
            return;
        }

        const shades = (dataField === '인원') ? blueShades : purpleShades;
        const unit = (dataField === '인원') ? '명' : '원';
        const needsZoom = partners.length > 6;

        const currRegionTotals = {};
        currArray.forEach(d => { currRegionTotals[d.지역] = (currRegionTotals[d.지역] || 0) + (d[dataField] || 0); });
        const prevRegionTotals = {};
        prevArray.forEach(d => { prevRegionTotals[d.지역] = (prevRegionTotals[d.지역] || 0) + (d[dataField] || 0); });

        const sortedRegionsCurr = [...regions].sort((a, b) => (currRegionTotals[b] || 0) - (currRegionTotals[a] || 0));
        const sortedRegionsPrev = [...regions].sort((a, b) => (prevRegionTotals[b] || 0) - (prevRegionTotals[a] || 0));

        const prevTotals = partners.map(p =>
            prevArray.filter(d => d.협력사 === p).reduce((s, d) => s + (d[dataField] || 0), 0)
        );
        const currTotals = partners.map(p =>
            currArray.filter(d => d.협력사 === p).reduce((s, d) => s + (d[dataField] || 0), 0)
        );

        let maxTotal = Math.max(...prevTotals, ...currTotals, 1);
        maxTotal = Math.max(maxTotal * 1.15, 10);
        const H_GRID = 420.0;
        const scale = H_GRID / maxTotal;

        const seriesData = [];

        seriesData.push(
            {
                name: `${prevLegend} (이전)`,
                type: 'bar',
                stack: prevLegend,
                silent: true,
                tooltip: { show: false },
                legendHoverLink: false,
                itemStyle: { color: '#94a3b8', borderColor: '#64748b', borderWidth: 1 },
                label: { show: false },
                data: partners.map(() => 0)
            },
            {
                name: `${currLegend} (${periodSuffix})`,
                type: 'bar',
                stack: currLegend,
                silent: true,
                tooltip: { show: false },
                legendHoverLink: false,
                itemStyle: { color: dataField === '인원' ? '#2563eb' : '#7c3aed' },
                label: { show: false },
                data: partners.map(() => 0)
            }
        );

        const computeOffsets = (partnerName, dataArr, sortedRegs, isPrev) => {
            const active = [];
            sortedRegs.forEach(reg => {
                const m = dataArr.find(d => d.협력사 === partnerName && d.지역 === reg);
                const val = m ? (m[dataField] || 0) : 0;
                if (val > 0) active.push({ region: reg, val: val });
            });
            const offsets = {};
            if (active.length === 0) return offsets;

            let cum = 0;
            const mids = [];
            active.forEach(item => {
                const mid = cum + item.val / 2.0;
                cum += item.val;
                mids.push({ region: item.region, val: item.val, mid: mid });
            });

            const n = active.length;
            const sign = isPrev ? -1 : 1;
            const y_pos = mids.map(m => m.mid * scale);
            const target_y = [...y_pos];
            const MIN_GAP = 30.0;

            for (let i = 1; i < n; i++) {
                if (target_y[i] - target_y[i - 1] < MIN_GAP) target_y[i] = target_y[i - 1] + MIN_GAP;
            }
            for (let i = n - 2; i >= 0; i--) {
                if (target_y[i + 1] - target_y[i] < MIN_GAP) target_y[i] = target_y[i + 1] - MIN_GAP;
            }

            for (let i = 0; i < n; i++) {
                const reg = mids[i].region;
                const dy_px = Math.round(-(target_y[i] - y_pos[i]));
                const dx_px = Math.round(sign * (12 + Math.abs(dy_px) * 0.9));
                offsets[reg] = { dx: dx_px, dy: dy_px, heightPx: mids[i].val * scale };
            }
            return offsets;
        };

        const prevOffsetsMap = {};
        const currOffsetsMap = {};
        partners.forEach(p => {
            prevOffsetsMap[p] = computeOffsets(p, prevArray, sortedRegionsPrev, true);
            currOffsetsMap[p] = computeOffsets(p, currArray, sortedRegionsCurr, false);
        });

        const currColorMap = {};

        sortedRegionsPrev.forEach(r => {
            const prevRank = sortedRegionsPrev.indexOf(r);
            const prevShade = grayShades[Math.min(prevRank, grayShades.length - 1)];

            seriesData.push({
                name: `${r} (${prevLegend})`,
                stack: prevLegend,
                type: 'bar',
                barGap: '12%',
                barMaxWidth: 44,
                itemStyle: {
                    color: prevShade.bg,
                    borderColor: '#ffffff',
                    borderWidth: 1.2,
                    borderRadius: [2, 2, 0, 0]
                },
                data: partners.map(p => {
                    const match = prevArray.find(d => d.협력사 === p && d.지역 === r);
                    const val = match ? match[dataField] : 0;
                    if (!val || val <= 0) return { value: 0, label: { show: false } };

                    const offInfo = prevOffsetsMap[p]?.[r] || { dx: -12, dy: 0, heightPx: val * scale };
                    const isTall = (offInfo.heightPx >= 34);
                    const valStr = dataField === '지상비' ? formatCompactWon(val) : `${formatNum(val)}명`;

                    if (isTall) {
                        return {
                            value: val,
                            label: {
                                show: true,
                                position: 'inside',
                                align: 'center',
                                verticalAlign: 'middle',
                                color: '#ffffff',
                                fontSize: 10,
                                fontWeight: 800,
                                fontFamily: 'Pretendard, sans-serif',
                                lineHeight: 14,
                                textBorderColor: 'rgba(0,0,0,0.6)',
                                textBorderWidth: 2,
                                formatter: `${r}
${valStr}`
                            }
                        };
                    } else {
                        return {
                            value: val,
                            label: {
                                show: true,
                                position: 'left',
                                distance: 8,
                                align: 'center',
                                color: '#334155',
                                fontSize: 9.5,
                                fontWeight: 700,
                                fontFamily: 'Pretendard, sans-serif',
                                lineHeight: 13,
                                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                borderColor: '#cbd5e1',
                                borderWidth: 1,
                                borderRadius: 4,
                                padding: [3, 6],
                                offset: [offInfo.dx, offInfo.dy],
                                formatter: `${r}
${valStr}`
                            },
                            labelLine: {
                                show: true,
                                showAbove: true,
                                length: Math.max(10, Math.round(Math.abs(offInfo.dx) * 0.75)),
                                length2: 6,
                                minTurnAngle: 0,
                                lineStyle: { color: '#94a3b8', width: 1.2 }
                            }
                        };
                    }
                })
            });
        });

        sortedRegionsCurr.forEach(r => {
            const currRank = sortedRegionsCurr.indexOf(r);
            const currShade = shades[Math.min(currRank, shades.length - 1)];
            currColorMap[r] = currShade.bg;

            seriesData.push({
                name: `${r} (${currLegend})`,
                stack: currLegend,
                type: 'bar',
                barMaxWidth: 44,
                itemStyle: {
                    color: currShade.bg,
                    borderColor: '#ffffff',
                    borderWidth: 1.2,
                    borderRadius: [2, 2, 0, 0]
                },
                data: partners.map(p => {
                    const match = currArray.find(d => d.협력사 === p && d.지역 === r);
                    const val = match ? match[dataField] : 0;
                    if (!val || val <= 0) return { value: 0, label: { show: false } };

                    const offInfo = currOffsetsMap[p]?.[r] || { dx: 12, dy: 0, heightPx: val * scale };
                    const isTall = (offInfo.heightPx >= 34);
                    const valStr = dataField === '지상비' ? formatCompactWon(val) : `${formatNum(val)}명`;

                    if (isTall) {
                        return {
                            value: val,
                            label: {
                                show: true,
                                position: 'inside',
                                align: 'center',
                                verticalAlign: 'middle',
                                color: currShade.text,
                                fontSize: 10,
                                fontWeight: 800,
                                fontFamily: 'Pretendard, sans-serif',
                                lineHeight: 14,
                                textBorderColor: currShade.text === '#ffffff' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.8)',
                                textBorderWidth: 2,
                                formatter: `${r}
${valStr}`
                            }
                        };
                    } else {
                        return {
                            value: val,
                            label: {
                                show: true,
                                position: 'right',
                                distance: 8,
                                align: 'center',
                                color: '#1e293b',
                                fontSize: 9.5,
                                fontWeight: 700,
                                fontFamily: 'Pretendard, sans-serif',
                                lineHeight: 13,
                                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                borderColor: '#cbd5e1',
                                borderWidth: 1,
                                borderRadius: 4,
                                padding: [3, 6],
                                offset: [offInfo.dx, offInfo.dy],
                                formatter: `${r}
${valStr}`
                            },
                            labelLine: {
                                show: true,
                                showAbove: true,
                                length: Math.max(10, Math.round(Math.abs(offInfo.dx) * 0.75)),
                                length2: 6,
                                minTurnAngle: 0,
                                lineStyle: { color: currShade.bg, width: 1.2 }
                            }
                        };
                    }
                })
            });
        });

        seriesData.push(
            {
                name: '_prev_total_',
                type: 'bar',
                stack: prevLegend,
                itemStyle: { color: 'transparent' },
                tooltip: { show: false },
                silent: true,
                label: {
                    show: true,
                    position: 'top',
                    distance: 6,
                    color: '#64748b',
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: 'Pretendard, sans-serif',
                    formatter: (p) => {
                        const val = prevTotals[p.dataIndex];
                        return val > 0 ? (dataField === '지상비' ? formatCompactWon(val) : formatNum(val)) : '';
                    }
                },
                data: partners.map(() => 0)
            },
            {
                name: '_curr_total_',
                type: 'bar',
                stack: currLegend,
                itemStyle: { color: 'transparent' },
                tooltip: { show: false },
                silent: true,
                label: {
                    show: true,
                    position: 'top',
                    distance: 6,
                    color: dataField === '인원' ? '#1d4ed8' : '#6b21a8',
                    fontSize: 11.5,
                    fontWeight: 800,
                    fontFamily: 'Pretendard, sans-serif',
                    formatter: (p) => {
                        const val = currTotals[p.dataIndex];
                        const pVal = prevTotals[p.dataIndex] || 0;
                        const diff = val - pVal;
                        const rate = pVal > 0 ? ((diff / pVal) * 100).toFixed(0) + '%' : '';
                        const tag = pVal > 0 ? (diff > 0 ? `▲+${rate}` : diff < 0 ? `▼${rate}` : `-`) : '';
                        const tagColor = diff > 0 ? '#16a34a' : (diff < 0 ? '#dc2626' : '#64748b');
                        const baseStr = val > 0 ? (dataField === '지상비' ? formatCompactWon(val) : formatNum(val)) : '';
                        if (!baseStr) return '';
                        return tag ? `${baseStr}
{tag|${tag}}` : baseStr;
                    },
                    rich: {
                        tag: {
                            fontSize: 10,
                            fontWeight: 800,
                            lineHeight: 14,
                            align: 'center'
                        }
                    }
                },
                data: partners.map(() => 0)
            }
        );

        chartInstance.setOption({
            textStyle: { fontFamily: 'Pretendard, sans-serif' },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                backgroundColor: 'rgba(255, 255, 255, 0.98)',
                borderColor: '#cbd5e1',
                borderWidth: 1,
                padding: [12, 16],
                textStyle: { color: '#1e293b', fontSize: 12, fontFamily: 'Pretendard, sans-serif' },
                extraCssText: 'box-shadow: 0 10px 25px rgba(0,0,0,0.12); border-radius: 12px; min-width: 250px;',
                formatter: function (params) {
                    if (!params || !params.length) return '';
                    const partnerName = params[0].axisValue;
                    const partnerIdx = partners.indexOf(partnerName);
                    const prevTot = prevTotals[partnerIdx] || 0;
                    const currTot = currTotals[partnerIdx] || 0;
                    const diff = currTot - prevTot;
                    const rate = prevTot > 0 ? ((diff / prevTot) * 100).toFixed(1) + '%' : (currTot > 0 ? '신규' : '0%');
                    const diffColor = diff > 0 ? '#16a34a' : (diff < 0 ? '#dc2626' : '#64748b');
                    const diffSign = diff > 0 ? '+' : '';

                    let html = `<div style="font-weight:800; font-size:14px; margin-bottom:8px; color:#0f172a; border-bottom:1.5px solid #e2e8f0; padding-bottom:6px;">🏢 ${partnerName}</div>
                        <div style="display:flex; justify-content:space-between; gap:16px; margin-bottom:4px; font-size:12px;">
                            <span style="color:#64748b;">${prevLegend} (이전 총계):</span>
                            <strong style="color:#475569;">${formatNum(prevTot)} ${unit}</strong>
                        </div>
                        <div style="display:flex; justify-content:space-between; gap:16px; margin-bottom:6px; font-size:12px;">
                            <span style="color:${dataField === '인원' ? '#2563eb' : '#7c3aed'}; font-weight:700;">${currLegend} (${periodSuffix} 총계):</span>
                            <strong style="color:#0f172a;">${formatNum(currTot)} ${unit}</strong>
                        </div>
                        <div style="display:flex; justify-content:space-between; gap:16px; margin-bottom:10px; padding-top:4px; border-top:1px dashed #e2e8f0; font-size:12px;">
                            <span style="color:#64748b;">총 증감:</span>
                            <strong style="color:${diffColor};">${diffSign}${formatNum(diff)} ${unit} (${diffSign}${rate})</strong>
                        </div>`;

                    const currPartnerData = currArray.filter(d => d.협력사 === partnerName && (d[dataField] || 0) > 0)
                        .sort((a, b) => b[dataField] - a[dataField]);

                    if (currPartnerData.length > 0) {
                        html += `<div style="font-weight:700; color:#64748b; margin-bottom:4px;">[${periodSuffix} 지역별 내역]</div>`;
                        currPartnerData.forEach(d => {
                            const dotColor = currColorMap[d.지역] || '#2563eb';
                            const share = currTot > 0 ? ((d[dataField] / currTot) * 100).toFixed(1) + '%' : '0%';
                            html += `<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:3px; font-size:11.5px;">
                                <span style="display:inline-flex; align-items:center; gap:6px;">
                                    <span style="width:8px; height:8px; border-radius:50%; background:${dotColor}; display:inline-block;"></span>
                                    <span style="color:#334155;">${d.지역}</span>
                                </span>
                                <span style="color:#0f172a; font-weight:600;">${formatNum(d[dataField])} ${unit} <span style="color:#94a3b8; font-weight:normal; font-size:10.5px;">(${share})</span></span>
                            </div>`;
                        });
                    }

                    return html;
                }
            },
            legend: {
                data: [`${prevLegend} (이전)`, `${currLegend} (${periodSuffix})`],
                orient: 'vertical',
                top: -8,
                right: 12,
                itemGap: 7,
                itemWidth: 12,
                itemHeight: 12,
                textStyle: { color: '#475569', fontSize: 11.5, fontWeight: 600, fontFamily: 'Pretendard, sans-serif' }
            },
            grid: { left: '3%', right: '4%', top: '55px', bottom: needsZoom ? '65px' : '45px', containLabel: true },
            xAxis: {
                type: 'category',
                data: partners,
                axisLabel: { color: '#1e293b', fontSize: 12, fontWeight: 600, interval: 0, rotate: 0, margin: 12, fontFamily: 'Pretendard, sans-serif' },
                axisLine: { lineStyle: { color: '#cbd5e1' } }
            },
            yAxis: {
                type: 'value',
                max: maxTotal,
                axisLabel: { color: '#64748b', fontSize: 11, fontFamily: 'Pretendard, sans-serif', formatter: val => dataField === '지상비' ? formatCompactWon(val) : formatNum(val) },
                splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)' } }
            },
            dataZoom: needsZoom ? [
                {
                    type: 'slider',
                    show: true,
                    xAxisIndex: [0],
                    bottom: 8,
                    height: 24,
                    startValue: 0,
                    endValue: Math.min(partners.length - 1, 5),
                    fillerColor: dataField === '인원' ? 'rgba(37, 99, 235, 0.15)' : 'rgba(124, 58, 237, 0.15)',
                    borderColor: '#cbd5e1',
                    handleStyle: { color: dataField === '인원' ? '#2563eb' : '#7c3aed' },
                    textStyle: { color: '#64748b', fontSize: 11, fontWeight: 600, fontFamily: 'Pretendard, sans-serif' },
                    brushSelect: false,
                    showDetail: true
                },
                { type: 'inside', xAxisIndex: [0], zoomOnMouseWheel: false, moveOnMouseMove: true }
            ] : [],
            series: seriesData
        }, true);

        requestAnimationFrame(() => {
            chartInstance.resize();
            setTimeout(() => chartInstance.resize(), 100);
        });
    };

    setStackedChart(charts.chart1, '인원');
    if (charts.chart2) setStackedChart(charts.chart2, '지상비');
}

function updatePieChart(dataArray) {
    const pieSelect = document.getElementById('pieTargetSelect');
    const pieTitle = document.getElementById('pieChartTitle');
    const pieLabel = document.getElementById('pieTargetLabel');

    if (!charts.pieChart) return;
    if (!dataArray || dataArray.length === 0) {
        charts.pieChart.clear();
        charts.pieChart.setOption({
            title: {
                text: '선택된 기간에 조회된 데이터가 없습니다.',
                left: 'center',
                top: 'middle',
                textStyle: { color: '#94a3b8', fontSize: 14, fontWeight: 500, fontFamily: 'Pretendard, sans-serif' }
            }
        });
        const pieLegendList = document.getElementById('pieLegendList');
        if (pieLegendList) pieLegendList.innerHTML = '<div style="text-align:center; padding:30px; color:#94a3b8; font-size:0.9rem;">데이터가 없습니다.</div>';
        return;
    }

    const donutColors = [
        '#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626',
        '#0891b2', '#4f46e5', '#db2777', '#ea580c', '#65a30d',
        '#64748b', '#0284c7', '#9333ea', '#16a34a', '#ca8a04'
    ];

    let pieData = [];
    let totalVal = 0;
    let topItemName = '-';
    let topItemPct = '0%';
    let legendDataForTable = []; // 테이블 범례용 (기타 제외)

    if (pieMode === 'region') {
        const isAll = (pieTarget === 'all');
        if (pieTitle) {
            pieTitle.innerText = isAll ? `지역별 협력사 송출 점유율 (TOP 10)` : `${pieTarget} 협력사 송출 점유율 (TOP 10)`;
        }
        if (pieLabel) pieLabel.innerText = '기준 지역:';

        const allRegions = [...new Set(dataArray.map(d => d.지역))].sort();
        if (pieSelect) {
            pieSelect.innerHTML = `<option value="all">전체 지역 종합</option>` +
                allRegions.map(r => `<option value="${r}">${r}</option>`).join('');

            if (pieTarget && (pieTarget === 'all' || allRegions.includes(pieTarget))) {
                pieSelect.value = pieTarget;
            } else {
                pieTarget = 'all';
                pieSelect.value = 'all';
            }
        }

        const targetData = (pieTarget === 'all') ? dataArray : dataArray.filter(d => d.지역 === pieTarget);
        const partnerMap = {};
        targetData.forEach(d => { partnerMap[d.협력사] = (partnerMap[d.협력사] || 0) + (d.인원 || 0); });

        const sortedPartners = Object.entries(partnerMap).sort((a, b) => b[1] - a[1]);
        totalVal = sortedPartners.reduce((s, x) => s + x[1], 0);

        if (sortedPartners.length > 0) {
            topItemName = sortedPartners[0][0];
            topItemPct = totalVal > 0 ? ((sortedPartners[0][1] / totalVal) * 100).toFixed(1) + '%' : '0%';
        }

        const top10 = sortedPartners.slice(0, 10);
        // 도넛 차트 및 테이블 모두 TOP 10만 노출 (기타 항목 비노출)
        // 단, 총 송출 인원(totalVal)과 각 점유율(%)은 전체 기준으로 유지 및 산출
        pieData = top10.map(([name, val]) => ({ name: name, value: val }));
        legendDataForTable = pieData;

    } else {
        const isAll = (pieTarget === 'all');
        if (pieTitle) {
            pieTitle.innerText = isAll ? `협력사별 지역 송출 비중 (TOP 10)` : `${pieTarget} 지역 송출 비중`;
        }
        if (pieLabel) pieLabel.innerText = '기준 협력사:';

        const partnerSums = {};
        dataArray.forEach(d => { partnerSums[d.협력사] = (partnerSums[d.협력사] || 0) + (d.인원 || 0); });
        const allPartners = Object.keys(partnerSums).sort((a, b) => partnerSums[b] - partnerSums[a]);

        if (pieSelect) {
            pieSelect.innerHTML = `<option value="all">전체 협력사 합산</option>` +
                allPartners.map(p => `<option value="${p}">${p} (${formatNum(partnerSums[p])}명)</option>`).join('');

            if (pieTarget && (pieTarget === 'all' || allPartners.includes(pieTarget))) {
                pieSelect.value = pieTarget;
            } else {
                pieTarget = 'all';
                pieSelect.value = 'all';
            }
        }

        const targetData = (pieTarget === 'all') ? dataArray : dataArray.filter(d => d.협력사 === pieTarget);
        const regionMap = {};
        targetData.forEach(d => { regionMap[d.지역] = (regionMap[d.지역] || 0) + (d.인원 || 0); });

        const sortedRegions = Object.entries(regionMap).sort((a, b) => b[1] - a[1]);
        totalVal = sortedRegions.reduce((s, x) => s + x[1], 0);

        if (sortedRegions.length > 0) {
            topItemName = sortedRegions[0][0];
            topItemPct = totalVal > 0 ? ((sortedRegions[0][1] / totalVal) * 100).toFixed(1) + '%' : '0%';
        }

        const top10 = sortedRegions.slice(0, 10);
        pieData = top10.map(([name, val]) => ({ name: name, value: val }));
        legendDataForTable = pieData; // 협력사별 모드: 전체 지역 표시 (TOP 10)
    }

    charts.pieChart.setOption({
        color: donutColors,
        textStyle: { fontFamily: 'Pretendard, sans-serif' },
        tooltip: {
            trigger: 'item',
            backgroundColor: 'rgba(255, 255, 255, 0.98)',
            borderColor: '#cbd5e1',
            borderWidth: 1,
            padding: [10, 14],
            textStyle: { color: '#1e293b', fontSize: 12, fontFamily: 'Pretendard, sans-serif' },
            extraCssText: 'box-shadow: 0 8px 20px rgba(0,0,0,0.1); border-radius: 10px;',
            formatter: function (p) {
                // 점유율 계산: 차트의 슬라이스 합이 아닌 기타 포함 전체 송출인원(totalVal) 기준
                const pct = totalVal > 0 ? ((p.value / totalVal) * 100).toFixed(1) + '%' : '0%';
                return `<div style="font-weight:700; font-size:13px; margin-bottom:4px; color:#0f172a;">${p.name}</div>
                    <div style="display:flex; justify-content:space-between; gap:16px; font-size:12px;">
                        <span style="color:#64748b;">송출 인원:</span>
                        <strong style="color:#2563eb;">${formatNum(p.value)}명</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; gap:16px; font-size:12px; margin-top:2px;">
                        <span style="color:#64748b;">점유율:</span>
                        <strong style="color:#0f172a;">${pct}</strong>
                    </div>`;
            }
        },
        title: {
            text: `{val|${formatNum(totalVal)}}{unit|명}
{sub|총 송출 인원}`,
            left: 'center',
            top: '38%',
            textStyle: {
                rich: {
                    val: { fontSize: 22, fontWeight: 800, color: '#0f172a', fontFamily: 'Pretendard, sans-serif', lineHeight: 28 },
                    unit: { fontSize: 13, fontWeight: 600, color: '#64748b', fontFamily: 'Pretendard, sans-serif', padding: [0, 0, 4, 2] },
                    sub: { fontSize: 11.5, color: '#64748b', fontWeight: 500, fontFamily: 'Pretendard, sans-serif', lineHeight: 18 }
                }
            }
        },
        legend: { show: false },
        series: [
            {
                name: pieMode === 'region' ? '협력사' : '지역',
                type: 'pie',
                radius: ['52%', '76%'],
                center: ['50%', '48%'],
                avoidLabelOverlap: true,
                itemStyle: {
                    borderRadius: 6,
                    borderColor: '#ffffff',
                    borderWidth: 2
                },
                label: {
                    show: false,
                    position: 'center'
                },
                emphasis: {
                    scale: true,
                    scaleSize: 8,
                    itemStyle: {
                        shadowBlur: 15,
                        shadowOffsetX: 0,
                        shadowColor: 'rgba(0, 0, 0, 0.2)'
                    }
                },
                data: pieData
            }
        ]
    }, true);

    // 테이블 범례: region 전체 지역 종합 시 기타 제외 TOP7, 그 외 pieData 그대로
    renderPieLegendList(legendDataForTable.length > 0 ? legendDataForTable : pieData, totalVal, donutColors);
}

function renderPieLegendList(pieData, totalVal, donutColors) {
    const listEl = document.getElementById('pieLegendList');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (!pieData || pieData.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; padding:30px; color:#94a3b8; font-size:0.9rem;">데이터가 없습니다.</div>';
        return;
    }

    pieData.forEach((item, idx) => {
        const color = donutColors[idx % donutColors.length];
        const pct = totalVal > 0 ? ((item.value / totalVal) * 100).toFixed(1) + '%' : '0%';
        const rank = idx + 1;
        const rankBadgeClass = rank === 1 ? 'pie-rank-1' : (rank === 2 ? 'pie-rank-2' : (rank === 3 ? 'pie-rank-3' : 'pie-rank-n'));

        const row = document.createElement('div');
        row.className = 'pie-legend-row';
        row.innerHTML = `
            <span class="pie-legend-rank ${rankBadgeClass}">${rank}</span>
            <div class="pie-legend-name-col" title="${item.name}">
                <span class="pie-legend-dot" style="background:${color};"></span>
                <span class="pie-legend-name">${item.name}</span>
            </div>
            <span class="pie-legend-val text-right">${formatNum(item.value)}명</span>
            <span class="pie-legend-pct text-right">${pct}</span>
        `;

        row.addEventListener('mouseenter', () => {
            if (charts.pieChart) {
                charts.pieChart.dispatchAction({ type: 'highlight', dataIndex: idx });
                charts.pieChart.dispatchAction({ type: 'showTip', dataIndex: idx });
            }
        });
        row.addEventListener('mouseleave', () => {
            if (charts.pieChart) {
                charts.pieChart.dispatchAction({ type: 'downplay', dataIndex: idx });
                charts.pieChart.dispatchAction({ type: 'hideTip' });
            }
        });

        listEl.appendChild(row);
    });
}

function computeQuadrantData(dataArray, baseAllData) {
    if (!dataArray || dataArray.length === 0) return [];

    const baseCurr = (baseAllData && baseAllData.length > 0) ? baseAllData : dataArray;
    const regionStats = {};

    baseCurr.forEach(d => {
        const reg = d.지역 || '기타';
        if (!regionStats[reg]) {
            regionStats[reg] = { totalPers: 0, totalCost: 0, count: 0 };
        }
        regionStats[reg].totalPers += (d.인원 || 0);
        regionStats[reg].totalCost += (d.지상비 || 0);
        regionStats[reg].count += 1;
    });

    const regionAverages = {};
    Object.keys(regionStats).forEach(reg => {
        const st = regionStats[reg];
        const avgPers = st.count > 0 ? (st.totalPers / st.count) : 0;
        const avgUnitCost = st.totalPers > 0 ? Math.round(st.totalCost / st.totalPers) : 0;
        regionAverages[reg] = { avgPers, avgUnitCost };
    });

    return dataArray.map(d => {
        const pers = d.인원 || 0;
        const cost = d.지상비 || 0;
        const unitCost = d['인당 지상비'] || (pers > 0 ? Math.round(cost / pers) : 0);
        const reg = d.지역 || '기타';

        const regAvg = regionAverages[reg] || {
            avgPers: dataArray.reduce((s, x) => s + (x.인원 || 0), 0) / dataArray.length,
            avgUnitCost: dataArray.reduce((s, x) => s + (x.지상비 || 0), 0) / (dataArray.reduce((s, x) => s + (x.인원 || 0), 0) || 1)
        };

        const isHighPers = (pers >= regAvg.avgPers);
        const isLowCost = (unitCost <= regAvg.avgUnitCost);

        let qCode, qText, qClass, qOrder;

        if (isHighPers && isLowCost) {
            qCode = 'Q1'; qText = '대규모·저단가'; qClass = 'q-excellent'; qOrder = 1;
        } else if (!isHighPers && isLowCost) {
            qCode = 'Q2'; qText = '소규모·저단가'; qClass = 'q-efficient'; qOrder = 2;
        } else if (isHighPers && !isLowCost) {
            qCode = 'Q3'; qText = '대규모·고단가'; qClass = 'q-warning'; qOrder = 3;
        } else {
            qCode = 'Q4'; qText = '소규모·고단가'; qClass = 'q-poor'; qOrder = 4;
        }

        return {
            ...d,
            '인당 지상비': unitCost,
            _regAvgPers: regAvg.avgPers,
            _regAvgUnitCost: regAvg.avgUnitCost,
            _qCode: qCode,
            _qText: qText,
            _qClass: qClass,
            _qOrder: qOrder
        };
    });
}

function handleSort(colName) {
    if (sortCol === colName) {
        sortDesc = !sortDesc;
    } else {
        sortCol = colName;
        sortDesc = true;
    }
    applyFilter();
}

const tableColsPartner = [
    { key: '지역', name: '지역' },
    { key: '인원', name: '송출 인원', align: 'right' },
    { key: '지상비', name: '지상비', align: 'right' },
    { key: '인당 지상비', name: '인당 지상비', align: 'right' },
    { key: '_qOrder', name: '구분 기준', align: 'center' }
];

const tableColsGroup = [
    { key: '협력사', name: '협력사' },
    { key: '인원', name: '송출 인원', align: 'right' },
    { key: '지상비', name: '지상비', align: 'right' },
    { key: '인당 지상비', name: '인당 지상비', align: 'right' },
    { key: '_qOrder', name: '구분 기준', align: 'center' }
];

function renderTable(dataArray, baseAllData) {
    const tHeadRow = document.getElementById('tableHeadRow');
    const tBody = document.getElementById('tableBody');
    // 표시 모드: 전체 탭은 팀목 표시, 본부/단일팀 탭은 팀목 숨김
    const showTeam = (selectedTeam === 'all');

    let enrichedArray = computeQuadrantData(dataArray, baseAllData);

    if (selectedQuadrant && selectedQuadrant !== 'all') {
        enrichedArray = enrichedArray.filter(d => d._qCode === selectedQuadrant);
    }

    const countEl = document.getElementById('dataCount');
    if (countEl) countEl.innerText = `${enrichedArray.length}건 탑재됨`;
    if (tHeadRow) tHeadRow.innerHTML = '';
    if (tBody) tBody.innerHTML = '';

    const currentCols = (tableViewMode === 'group') ? tableColsGroup : tableColsPartner;
    currentCols.forEach(col => {
        const th = document.createElement('th');
        if (col.align) th.className = `text-${col.align}`;
        let iconHtml = '<span class="sort-icon">⇅</span>';
        if (sortCol === col.key) iconHtml = sortDesc ? `<span class="sort-icon active-desc">▼</span>` : `<span class="sort-icon active-asc">▲</span>`;
        th.innerHTML = `<span class="sort-btn" onclick="handleSort('${col.key}')">${col.name} ${iconHtml}</span>`;
        if (tHeadRow) tHeadRow.appendChild(th);
    });

    if (enrichedArray.length === 0) {
        if (tBody) {
            tBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 48px; color:#94a3b8; font-size:0.95rem;">선택된 기간에 조회된 데이터가 없습니다.</td></tr>`;
        }
        return;
    }

    let displayArray = [...enrichedArray];

    if (tableViewMode === 'partner') {
        const partnerMap = {};
        displayArray.forEach(d => {
            if (!partnerMap[d.협력사]) {
                partnerMap[d.협력사] = {
                    partner: d.협력사,
                    items: [],
                    totalPersonnel: 0,
                    totalCost: 0
                };
            }
            partnerMap[d.협력사].items.push(d);
            partnerMap[d.협력사].totalPersonnel += (d.인원 || 0);
            partnerMap[d.협력사].totalCost += (d.지상비 || 0);
        });

        const sortedPartnerKeys = Object.keys(partnerMap).sort((a, b) => {
            return partnerMap[b].totalPersonnel - partnerMap[a].totalPersonnel;
        });

        sortedPartnerKeys.forEach((partnerName, idx) => {
            const pGroup = partnerMap[partnerName];
            const rank = idx + 1;
            const rankClass = rank === 1 ? 'partner-rank-1' : (rank === 2 ? 'partner-rank-2' : (rank === 3 ? 'partner-rank-3' : ''));
            const avgUnitCost = pGroup.totalPersonnel > 0 ? Math.round(pGroup.totalCost / pGroup.totalPersonnel) : 0;
            const regionCount = [...new Set(pGroup.items.map(x => x.지역))].length;

            const pRow = document.createElement('tr');
            pRow.className = 'partner-group-header-row';
            pRow.innerHTML = `<td colspan="5">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <div>
                        <span class="partner-rank-badge ${rankClass}">${rank}위</span>
                        <strong style="font-size:1rem; color:var(--text-primary);">${partnerName}</strong>
                        <span style="font-size:0.8rem; color:#64748b; margin-left:6px;">(${regionCount}개 지역 송출)</span>
                    </div>
                    <div style="font-size:0.86rem; color:#475569;">
                        소계: 송출인원 <strong style="color:var(--accent-blue);">${formatNum(pGroup.totalPersonnel)}명</strong>
                        <span style="color:#cbd5e1; margin:0 6px;">|</span>
                        지상비 <strong>${formatNum(pGroup.totalCost)}원</strong>
                        <span style="color:#cbd5e1; margin:0 6px;">|</span>
                        평균 인당 <strong>${formatNum(avgUnitCost)}원</strong>
                    </div>
                </div>
            </td>`;
            if (tBody) tBody.appendChild(pRow);

            const arr = [...pGroup.items];
            if (sortCol && sortCol !== '협력사') {
                arr.sort((a, b) => {
                    let valA = a[sortCol], valB = b[sortCol];
                    if (typeof valA === 'string') valA = valA.toLowerCase();
                    if (typeof valB === 'string') valB = valB.toLowerCase();
                    if (valA < valB) return sortDesc ? 1 : -1;
                    if (valA > valB) return sortDesc ? -1 : 1;
                    return 0;
                });
            } else {
                arr.sort((a, b) => (b.인원 || 0) - (a.인원 || 0));
            }

            arr.forEach(d => {
                const tr = document.createElement('tr');
                const teamBadge = showTeam ? `<span style="font-size:0.75rem; color:#64748b; font-weight:normal; margin-left:6px;">(${d.팀})</span>` : '';
                tr.innerHTML = `<td style="font-weight:700; color:var(--accent-navy); padding-left:20px;">${d.지역}${teamBadge}</td>
                    <td class="text-right" style="color:var(--accent-blue);font-weight:700">${formatNum(d.인원)}</td>
                    <td class="text-right">${formatNum(d.지상비)}</td>
                    <td class="text-right">${formatNum(d['인당 지상비'])}</td>
                    <td class="text-center"><span class="quadrant-badge ${d._qClass}">${d._qText}</span></td>`;
                if (tBody) tBody.appendChild(tr);
            });
        });

    } else if (tableViewMode === 'group') {
        const groupMap = {};
        displayArray.forEach(d => {
            const groupKey = showTeam ? `${d.팀}___${d.지역}` : d.지역;
            if (!groupMap[groupKey]) {
                groupMap[groupKey] = {
                    team: d.팀,
                    region: d.지역,
                    items: [],
                    totalPersonnel: 0,
                    totalCost: 0
                };
            }
            groupMap[groupKey].items.push(d);
            groupMap[groupKey].totalPersonnel += (d.인원 || 0);
            groupMap[groupKey].totalCost += (d.지상비 || 0);
        });

        const sortedGroupKeys = Object.keys(groupMap).sort((kA, kB) => {
            const gA = groupMap[kA];
            const gB = groupMap[kB];
            if (showTeam) {
                const tiA = TEAM_ORDER.indexOf(gA.team) !== -1 ? TEAM_ORDER.indexOf(gA.team) : 999;
                const tiB = TEAM_ORDER.indexOf(gB.team) !== -1 ? TEAM_ORDER.indexOf(gB.team) : 999;
                if (tiA !== tiB) return tiA - tiB;
            }
            return gB.totalPersonnel - gA.totalPersonnel;
        });

        sortedGroupKeys.forEach(groupKey => {
            const g = groupMap[groupKey];
            const gRow = document.createElement('tr');
            gRow.className = 'group-header-row';
            const titleText = showTeam ? `[${g.team}] ${g.region}` : `[지역 구분] ${g.region}`;
            const avgCost = g.totalPersonnel > 0 ? Math.round(g.totalCost / g.totalPersonnel) : 0;
            gRow.innerHTML = `<td colspan="5">
                <strong>${titleText}</strong>
                <span style="font-weight:normal; font-size:0.85rem; color:#64748b; margin-left:10px;">
                    (지역 총 송출: <strong style="color:var(--accent-navy);">${formatNum(g.totalPersonnel)}명</strong> / 지상비: <strong>${formatNum(g.totalCost)}원</strong> / 평균 인당: <strong>${formatNum(avgCost)}원</strong>)
                </span>
            </td>`;
            if (tBody) tBody.appendChild(gRow);

            const maxPersonnelInGroup = Math.max(...g.items.map(item => item.인원 || 0));

            const arr = [...g.items];
            if (sortCol) {
                arr.sort((a, b) => {
                    let valA = a[sortCol], valB = b[sortCol];
                    if (typeof valA === 'string') valA = valA.toLowerCase();
                    if (typeof valB === 'string') valB = valB.toLowerCase();
                    if (valA < valB) return sortDesc ? 1 : -1;
                    if (valA > valB) return sortDesc ? -1 : 1;
                    return 0;
                });
            } else {
                arr.sort((a, b) => (b.인원 || 0) - (a.인원 || 0));
            }

            arr.forEach(d => {
                const tr = document.createElement('tr');
                const isTop = (d.인원 > 0 && d.인원 === maxPersonnelInGroup);
                if (isTop) tr.className = 'top-region-row';

                const teamBadge = showTeam ? `<span style="font-size:0.75rem; color:#64748b; font-weight:normal; margin-left:6px;">(${d.팀})</span>` : '';
                tr.innerHTML = `<td style="padding-left:20px; font-weight:700; color:var(--accent-navy);">${d.협력사}${teamBadge}${isTop ? '<span class="top-badge">1위</span>' : ''}</td>
                    <td class="text-right" style="color:var(--accent-cyan);font-weight:700">${formatNum(d.인원)}</td>
                    <td class="text-right">${formatNum(d.지상비)}</td>
                    <td class="text-right">${formatNum(d['인당 지상비'])}</td>
                    <td class="text-center"><span class="quadrant-badge ${d._qClass}">${d._qText}</span></td>`;
                if (tBody) tBody.appendChild(tr);
            });
        });
    }
}







