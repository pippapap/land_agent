// === 전역 데이터 관리 ===
let rawData = [];
let selectedTeam = 'all'; 
let currentMonthDef = '';
let charts = {};

let chartCompareType = 'mom'; // 'mom' | 'yoy'
let tableViewMode = 'list'; // 'list' | 'group'

let sortCol = '';
let sortDesc = false;

// 팀 고정 순서 (정렬 기준)
const TEAM_ORDER = [
    "동남아1팀", "동남아2팀", "동남아3팀", "일본팀", "중국팀",
    "서유럽팀", "스페인/북유럽팀", "동유럽팀", "지중해/인도/아프리카팀",
    "프리미엄팀", "미주팀", "남태평양팀", "부산지점", "대구지점", "크루즈/테마팀"
];

// 테마 색상 팔레트
const colors = {
    primary: '#1d4ed8', cyan: '#2563eb', purple: '#4f46e5',
    green: '#059669', orange: '#ea580c', red: '#dc2626',
    text: '#1e293b', textMuted: '#64748b'
};

// === 데이터 전처리 (팀 병합 및 인원 0 필터링) ===
function preprocessData() {
    // 인원이 0 이하이거나 유효하지 않은 데이터 제외 (인원 0 노출 방지)
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

// ============================================================
// 실제 JSON 파일 로드
// data/index.json에 등록된 파일 목록을 읽어서 각 파일을 fetch합니다.
// GitHub Pages에서는 data/ 폴더 안에 파일이 있어야 합니다.
// 로컬 file:// 프로토콜에서는 CORS 오류가 발생할 수 있으므로,
// python -m http.server 등 로컬 서버를 통해 열어주세요.
// ============================================================
async function loadData() {
    try {
        // 1. 매니페스트 파일로 사용 가능한 월 목록 읽기
        const manifestRes = await fetch('./data/index.json');
        if (!manifestRes.ok) throw new Error('index.json 로드 실패');
        const manifest = await manifestRes.json();

        rawData = [];

        // 2. 각 파일 순서대로 fetch하여 rawData에 병합 (월 레이블 주입)
        for (const entry of manifest) {
            try {
                const res = await fetch(`./data/${entry.file}`);
                if (!res.ok) { console.warn(`파일 없음: ${entry.file}`); continue; }
                const fileData = await res.json();
                // 각 레코드에 '월' 필드 추가 (파일에는 없으므로 매니페스트 label 사용)
                fileData.forEach(d => { d.월 = entry.label; });
                rawData = rawData.concat(fileData);
            } catch (e) {
                console.warn(`${entry.file} 로드 오류:`, e);
            }
        }

        if (rawData.length === 0) throw new Error('데이터 없음');
        preprocessData();
        extractMonthsAndInit();
        initSidebar();
        initCharts();
        setupEventListeners();
        applyFilter();

    } catch (err) {
        console.error('데이터 로드 실패:', err);
        document.getElementById('currentTeamTitle').innerText = '⚠️ 데이터 로드 실패 — 로컬 서버에서 실행해 주세요.';
    }
}

document.addEventListener('DOMContentLoaded', loadData);

// === 월 드롭다운 세팅 ===
function extractMonthsAndInit() {
    const monthSelect = document.getElementById('monthSelect');
    const months = [...new Set(rawData.map(d => d.월))].sort();
    
    monthSelect.innerHTML = '';
    months.forEach(m => {
        monthSelect.innerHTML += `<option value="${m}">${m}</option>`;
    });
    
    if (months.length > 0) {
        currentMonthDef = months[months.length - 1];
        monthSelect.value = currentMonthDef;
    }
}

// === 비교 월 계산 (MoM 또는 YoY) ===
function getComparisonMonth(baseMonth, type) {
    if (!baseMonth || !baseMonth.includes('-')) return null;
    const [y, m] = baseMonth.split('-').map(Number);
    if (type === 'mom') {
        let py = y, pm = m - 1;
        if (pm === 0) { pm = 12; py -= 1; }
        return `${py}-${pm.toString().padStart(2, '0')}`;
    } else if (type === 'yoy') {
        return `${y - 1}-${m.toString().padStart(2, '0')}`;
    }
}

// === 사이드바 동적 생성 ===
function initSidebar() {
    const teamNav = document.getElementById('teamNav');
    // 기존 팀 항목들 제거 (전체 제외)
    Array.from(teamNav.querySelectorAll('.nav-item:not([data-team="all"])')).forEach(el => el.remove());

    teamNav.querySelector('[data-team="all"]').addEventListener('click', (e) => changeTeam('all', e.currentTarget));

    TEAM_ORDER.forEach(t => {
        const li = document.createElement('li');
        li.className = 'nav-item'; li.dataset.team = t; li.innerHTML = `<span>${t}</span>`;
        li.addEventListener('click', (e) => changeTeam(t, e.currentTarget));
        teamNav.appendChild(li);
    });
}

function changeTeam(tName, el) {
    selectedTeam = tName;
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('currentTeamTitle').innerText = (tName === 'all') ? '전체' : tName;
    applyFilter();
    // 탭(팀) 이동 시 페이지 최상단으로 스크롤 초기화
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setupEventListeners() {
    document.getElementById('monthSelect').addEventListener('change', (e) => {
        currentMonthDef = e.target.value;
        applyFilter();
    });

    window.addEventListener('resize', () => { Object.values(charts).forEach(c => c.resize()); });

    document.querySelectorAll('#globalCompareToggles .toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            chartCompareType = e.target.dataset.type;
            document.querySelectorAll('#globalCompareToggles .toggle-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.type === chartCompareType);
            });
            applyFilter();
        });
    });

    document.getElementById('viewModeList').addEventListener('click', () => {
        tableViewMode = 'list';
        document.getElementById('viewModeList').classList.add('active');
        document.getElementById('viewModeGroup').classList.remove('active');
        applyFilter();
    });
    document.getElementById('viewModeGroup').addEventListener('click', () => {
        tableViewMode = 'group';
        document.getElementById('viewModeGroup').classList.add('active');
        document.getElementById('viewModeList').classList.remove('active');
        applyFilter();
    });
}

const formatNum = (num) => new Intl.NumberFormat('ko-KR').format(num);

function getTrendHTML(curr, prev) {
    if (!prev || prev === 0) return `<span class="trend-neutral">- 신규 (비교 없음)</span>`;
    const diff = curr - prev;
    const rate = ((diff / prev) * 100).toFixed(1);
    if (diff > 0) return `<span class="trend-up">▲ ${formatNum(diff)} (+${rate}%)</span>`;
    if (diff < 0) return `<span class="trend-down">▼ ${formatNum(Math.abs(diff))} (${rate}%)</span>`;
    return `<span class="trend-neutral">- 변동 없음 (0%)</span>`;
}

function applyFilter() {
    const chartCompare = getComparisonMonth(currentMonthDef, chartCompareType);
    const kpiPrevMonth = getComparisonMonth(currentMonthDef, 'mom');

    const baseCurr = rawData.filter(d => d.월 === currentMonthDef);
    const baseChartPrev = rawData.filter(d => d.월 === chartCompare);
    const baseKpiPrev = rawData.filter(d => d.월 === kpiPrevMonth);

    const currTarget = (selectedTeam === 'all') ? baseCurr : baseCurr.filter(d => d.팀 === selectedTeam);
    const chartPrevTarget = (selectedTeam === 'all') ? baseChartPrev : baseChartPrev.filter(d => d.팀 === selectedTeam);
    const kpiPrevTarget = (selectedTeam === 'all') ? baseKpiPrev : baseKpiPrev.filter(d => d.팀 === selectedTeam);

    const sumP_curr = currTarget.reduce((s, d) => s + (d.인원 || 0), 0);
    const sumC_curr = currTarget.reduce((s, d) => s + (d.지상비 || 0), 0);
    const sumP_prev = kpiPrevTarget.reduce((s, d) => s + (d.인원 || 0), 0);
    const sumC_prev = kpiPrevTarget.reduce((s, d) => s + (d.지상비 || 0), 0);

    document.getElementById('kpiPersonnelCurrent').innerText = formatNum(sumP_curr);
    document.getElementById('kpiPersonnelTrend').innerHTML = getTrendHTML(sumP_curr, sumP_prev) + ' (전월 대비)';
    document.getElementById('kpiCostCurrent').innerText = formatNum(sumC_curr);
    document.getElementById('kpiCostTrend').innerHTML = getTrendHTML(sumC_curr, sumC_prev) + ' (전월 대비)';

    const getTop = (arr) => {
        if (arr.length === 0) return '-';
        const m = {}; arr.forEach(d => { m[d.협력사] = (m[d.협력사] || 0) + d.인원; });
        return Object.entries(m).sort((a, b) => b[1] - a[1])[0][0];
    };

    document.getElementById('kpiTopPartner').innerText = getTop(currTarget);
    document.getElementById('kpiTopPartnerPrev').innerText = `전월 최다: ${getTop(kpiPrevTarget)}`;

    if (selectedTeam === 'all') {
        updateAllCharts(currTarget, chartPrevTarget, chartCompare);
    } else {
        updateTeamCharts(currTarget, chartPrevTarget, chartCompare);
    }

    renderTable(currTarget);
}

function initCharts() {
    charts.chart1 = echarts.init(document.getElementById('chart1'));
    charts.chart2 = echarts.init(document.getElementById('chart2'));
}

// [1] 전체 탭 — 팀별 그룹 막대 차트
function updateAllCharts(currArray, prevArray, prevNameStr) {
    document.getElementById('chart1Title').innerText = `팀별 송출 인원 비교`;
    document.getElementById('chart2Title').innerText = `팀별 지상비 비교`;

    const aggregate = (dataArr) => {
        const result = {};
        dataArr.forEach(d => {
            if (!result[d.팀]) result[d.팀] = { 인원: 0, 비용: 0 };
            result[d.팀].인원 += d.인원; result[d.팀].비용 += d.지상비;
        });
        return result;
    };
    const cMap = aggregate(currArray);
    const pMap = aggregate(prevArray);
    // 팀 순서 유지
    const uniqueKeys = TEAM_ORDER.filter(t => cMap[t] || pMap[t]);

    const persCurrS = uniqueKeys.map(k => cMap[k]?.인원 || 0);
    const persPrevS = uniqueKeys.map(k => pMap[k]?.인원 || 0);
    const costCurrS = uniqueKeys.map(k => cMap[k]?.비용 || 0);
    const costPrevS = uniqueKeys.map(k => pMap[k]?.비용 || 0);

    const prevLegend = prevNameStr || '비교 없음';

    const setGroupChart = (chartInstance, prevS, currS, currColor) => {
        chartInstance.setOption({
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            legend: { data: [prevLegend, currentMonthDef], textStyle: { color: colors.text } },
            grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
            xAxis: { type: 'category', data: uniqueKeys, axisLabel: { color: colors.textMuted, interval: 0 } },
            yAxis: { type: 'value', splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)' } } },
            series: [
                { name: prevLegend, type: 'bar', data: prevS, itemStyle: { color: 'rgba(148, 163, 184, 0.4)' }, barGap: '10%' },
                { name: currentMonthDef, type: 'bar', data: currS, itemStyle: { color: currColor, borderRadius: [4, 4, 0, 0] } }
            ]
        }, true);
    };

    setGroupChart(charts.chart1, persPrevS, persCurrS, new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: colors.cyan }, { offset: 1, color: colors.primary }]));
    setGroupChart(charts.chart2, costPrevS, costCurrS, new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: colors.purple }, { offset: 1, color: colors.primary }]));
}

// [2] 팀별 탭 — 협력사 x 지역 스택 바
function updateTeamCharts(currArray, prevArray, prevNameStr) {
    document.getElementById('chart1Title').innerText = `협력사/지역별 송출 인원 비교`;
    document.getElementById('chart2Title').innerText = `협력사/지역별 지상비 비교`;

    const partners = [...new Set([...currArray, ...prevArray].map(d => d.협력사))];
    const partnerTotal = {};
    currArray.forEach(d => { partnerTotal[d.협력사] = (partnerTotal[d.협력사] || 0) + d.인원; });
    partners.sort((a, b) => (partnerTotal[b] || 0) - (partnerTotal[a] || 0));

    const regions = [...new Set([...currArray, ...prevArray].map(d => d.지역))].sort();
    const prevLegend = prevNameStr || '비교 없음';
    const palette = ['#1d4ed8', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#dc2626', '#14b8a6', '#6366f1'];

    // 현재월 막대의 최상단 세그먼트를 찾아 총계 라벨을 표시하기 위한 헬퍼
    const buildStackTopLabels = (dataField, stackName, dataArray) => {
        // 협력사별 총계 계산
        const totals = partners.map(p =>
            regions.reduce((sum, r) => {
                const match = dataArray.find(d => d.협력사 === p && d.지역 === r);
                return sum + (match ? (match[dataField] || 0) : 0);
            }, 0)
        );
        return totals;
    };

    const getSeries = (dataField) => {
        const series = [];
        const prevTotals = buildStackTopLabels(dataField, prevLegend, prevArray);
        const currTotals = buildStackTopLabels(dataField, currentMonthDef, currArray);

        regions.forEach((r, idx) => {
            const color = palette[idx % palette.length];

            series.push({
                name: r, stack: prevLegend, type: 'bar', barGap: '12%', barMaxWidth: 48,
                itemStyle: { color, opacity: 0.35 },
                label: {
                    show: true,
                    position: 'left',
                    distance: 6,
                    align: 'right',
                    verticalAlign: 'middle',
                    color: '#475569',
                    fontSize: 10,
                    fontWeight: 700,
                    lineHeight: 13,
                    formatter: p => {
                        if (!p.value || p.value <= 0) return '';
                        return `${r}\n${formatNum(p.value)}${dataField === '인원' ? '명' : '원'}`;
                    }
                },
                data: partners.map(p => { const match = prevArray.find(d => d.협력사 === p && d.지역 === r); return match ? match[dataField] : 0; })
            });
            series.push({
                name: r, stack: currentMonthDef, type: 'bar', barMaxWidth: 48,
                itemStyle: { color, opacity: 1 },
                label: {
                    show: true,
                    position: 'right',
                    distance: 6,
                    align: 'left',
                    verticalAlign: 'middle',
                    color: dataField === '인원' ? '#1d4ed8' : '#6b21a8',
                    fontSize: 10,
                    fontWeight: 700,
                    lineHeight: 13,
                    formatter: p => {
                        if (!p.value || p.value <= 0) return '';
                        return `${r}\n${formatNum(p.value)}${dataField === '인원' ? '명' : '원'}`;
                    }
                },
                data: partners.map(p => { const match = currArray.find(d => d.협력사 === p && d.지역 === r); return match ? match[dataField] : 0; })
            });
        });
        return series;
    };

    const setStackedChart = (chartInstance, field) => {
        const isCost = (field === '지상비');
        chartInstance.setOption({
            tooltip: {
                trigger: 'axis', axisPointer: { type: 'shadow' },
                formatter: function (params) {
                    if (!params.length) return '';
                    const axisValue = params[0].axisValue;
                    let prevTotal = 0; let currTotal = 0;
                    params.forEach(p => {
                        if (p.value > 0) { if (p.seriesIndex % 2 === 0) prevTotal += p.value; else currTotal += p.value; }
                    });
                    const fmt = v => isCost ? `${formatNum(v)}원` : `${formatNum(v)}명`;
                    return `<strong>[${axisValue}]</strong><br/>▷ ${prevLegend}: ${fmt(prevTotal)}<br/>▶ ${currentMonthDef}: ${fmt(currTotal)}`;
                }
            },
            legend: { show: false },
            grid: { left: '8px', right: '8px', bottom: '40px', top: '48px', containLabel: true },
            xAxis: {
                type: 'category',
                data: partners,
                axisLabel: { color: colors.textMuted, interval: 0, rotate: 0, fontSize: 12 }
            },
            yAxis: {
                type: 'value',
                splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)' } },
                axisLabel: { formatter: v => isCost ? (v >= 1000000 ? (v/1000000).toFixed(0)+'M' : formatNum(v)) : formatNum(v) }
            },
            series: getSeries(field)
        }, true);
    };

    setStackedChart(charts.chart1, '인원');
    setStackedChart(charts.chart2, '지상비');
}

// === 테이블 정렬 핸들러 ===
function handleSort(colName) {
    if (sortCol === colName) { sortDesc = !sortDesc; } else { sortCol = colName; sortDesc = false; }
    applyFilter();
}

const tableCols = [
    { key: '팀', name: '팀', isTeamCol: true },
    { key: '협력사', name: '협력사' },
    { key: '지역', name: '지역' },
    { key: '인원', name: '송출 인원', align: 'right' },
    { key: '지상비', name: '지상비', align: 'right' },
    { key: '인당 지상비', name: '인당 지상비', align: 'right' },
    { key: '_qOrder', name: '성과 구분', align: 'center' }
];

function renderTable(dataArray) {
    const tHeadRow = document.getElementById('tableHeadRow');
    const tBody = document.getElementById('tableBody');
    const showTeam = (selectedTeam === 'all');

    document.getElementById('dataCount').innerText = `${dataArray.length}건 탑재됨`;
    tHeadRow.innerHTML = ''; tBody.innerHTML = '';

    tableCols.forEach(col => {
        if (col.isTeamCol && !showTeam) return;
        const th = document.createElement('th');
        if (col.align) th.className = `text-${col.align}`;
        let iconHtml = '<span class="sort-icon">⇅</span>';
        if (sortCol === col.key) iconHtml = sortDesc ? `<span class="sort-icon active-desc">▼</span>` : `<span class="sort-icon active-asc">▲</span>`;
        th.innerHTML = `<span class="sort-btn" onclick="handleSort('${col.key}')">${col.name} ${iconHtml}</span>`;
        tHeadRow.appendChild(th);
    });

    let displayArray = [...dataArray];

    if (tableViewMode === 'list') {
        if (!sortCol) {
            displayArray.sort((a, b) => {
                const ti = TEAM_ORDER.indexOf(a.팀), tj = TEAM_ORDER.indexOf(b.팀);
                if (ti !== tj) return ti - tj;
                const cmp = a.협력사.localeCompare(b.협력사, 'ko');
                if (cmp !== 0) return cmp;
                return a.지역.localeCompare(b.지역, 'ko');
            });
        } else {
            displayArray.sort((a, b) => {
                let valA = a[sortCol], valB = b[sortCol];
                if (typeof valA === 'string') valA = valA.toLowerCase();
                if (typeof valB === 'string') valB = valB.toLowerCase();
                if (valA < valB) return sortDesc ? 1 : -1;
                if (valA > valB) return sortDesc ? -1 : 1;
                return 0;
            });
        }
        displayArray.forEach(d => {
            const tr = document.createElement('tr');
            if (showTeam) tr.innerHTML += `<td>${d.팀}</td>`;
            tr.innerHTML += `<td><strong>${d.협력사}</strong></td><td>${d.지역}</td><td class="text-right" style="color:var(--accent-cyan);font-weight:600">${formatNum(d.인원)}</td><td class="text-right">${formatNum(d.지상비)}</td><td class="text-right">${formatNum(d['인당 지상비'] || (d.인원 > 0 ? Math.round(d.지상비 / d.인원) : 0))}</td>`;
            tBody.appendChild(tr);
        });
    } else if (tableViewMode === 'group') {
        const regionMap = {};
        displayArray.forEach(d => { if (!regionMap[d.지역]) regionMap[d.지역] = []; regionMap[d.지역].push(d); });

        const sortedRegions = Object.keys(regionMap).sort((rA, rB) => {
            const tiA = TEAM_ORDER.indexOf(regionMap[rA][0]?.팀 || '');
            const tiB = TEAM_ORDER.indexOf(regionMap[rB][0]?.팀 || '');
            if (tiA !== tiB) return tiA - tiB;
            return rA.localeCompare(rB, 'ko');
        });

        sortedRegions.forEach(regionName => {
            const gRow = document.createElement('tr');
            gRow.className = 'group-header-row';
            gRow.innerHTML = `<td colspan="${showTeam ? 6 : 5}">[지역 구분] ${regionName}</td>`;
            tBody.appendChild(gRow);

            const arr = regionMap[regionName];
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
                arr.sort((a, b) => {
                    const ti = TEAM_ORDER.indexOf(a.팀), tj = TEAM_ORDER.indexOf(b.팀);
                    if (ti !== tj) return ti - tj;
                    return a.협력사.localeCompare(b.협력사, 'ko');
                });
            }

            arr.forEach(d => {
                const tr = document.createElement('tr');
                if (showTeam) tr.innerHTML += `<td>${d.팀}</td>`;
                tr.innerHTML += `<td style="padding-left:24px"><strong>${d.협력사}</strong></td><td style="color:var(--text-secondary)">${d.지역}</td><td class="text-right" style="color:var(--accent-cyan);font-weight:600">${formatNum(d.인원)}</td><td class="text-right">${formatNum(d.지상비)}</td><td class="text-right">${formatNum(d['인당 지상비'] || (d.인원 > 0 ? Math.round(d.지상비 / d.인원) : 0))}</td>`;
                tBody.appendChild(tr);
            });
        });
    }
}
