"use strict";

/* =========================================================
   가계부 앱 - 2단계 (예산 / 반복 거래 / 사용자·카테고리 관리 / 검색·필터)
   순수 HTML/CSS/JS, localStorage 저장
   ========================================================= */

const STORAGE_KEY = "household-budget:transactions"; // 1단계와 동일한 키 유지 (기존 데이터 보존)
const MEMBERS_KEY = "household-budget:members";
const CATEGORIES_KEY = "household-budget:categories";
const BUDGETS_KEY = "household-budget:budgets";
const RECURRING_KEY = "household-budget:recurring";

const DEFAULT_MEMBERS = ["본인", "가족", "공용"];

// 3단계 카테고리: 유형(수입/지출) > 중분류 > 소분류
const DEFAULT_CATEGORIES = {
  income: [
    { group: "고정수입", subs: ["급여", "용돈"] },
    { group: "비정기수입", subs: ["부수입", "상여금"] },
  ],
  expense: [
    { group: "고정지출", subs: ["주거", "통신", "구독", "저축", "투자", "보험", "관리비", "대출상환"] },
    {
      group: "개인지출",
      subs: ["식비", "교통", "쇼핑", "의료", "기타", "카페/간식", "문화/여가", "뷰티/미용", "교육", "반려동물", "경조사"],
    },
  ],
};

// 기존(이전 단계) 사용자의 저장된 카테고리에는 위 소분류 확장분이 없을 수 있으므로,
// 로드 시 이름이 겹치지 않는 것만 안전하게 추가해준다. (사용자가 이미 만든/수정한 항목은 건드리지 않음)
const NEW_CATEGORY_ADDITIONS = {
  income: [
    { group: "고정수입", name: "용돈" },
    { group: "비정기수입", name: "상여금" },
  ],
  expense: [
    { group: "고정지출", name: "보험" },
    { group: "고정지출", name: "관리비" },
    { group: "고정지출", name: "대출상환" },
    { group: "개인지출", name: "카페/간식" },
    { group: "개인지출", name: "문화/여가" },
    { group: "개인지출", name: "뷰티/미용" },
    { group: "개인지출", name: "교육" },
    { group: "개인지출", name: "반려동물" },
    { group: "개인지출", name: "경조사" },
  ],
};

const TYPE_LABEL = { income: "수입", expense: "지출" };

// 저축/투자는 실제 소비가 아닌 자산 이동으로 간주해 소비 분석에서는 따로 집계한다.
const ASSET_TRANSFER_SUBS = new Set(["저축", "투자"]);

function defaultKindFor(type, group, name) {
  if (type === "expense" && group === "고정지출" && ASSET_TRANSFER_SUBS.has(name)) return "asset_transfer";
  return "consumption";
}

/* ---------------- State ---------------- */

const state = {
  transactions: [],
  members: [],
  categories: { income: [], expense: [] },
  budgets: [],
  recurringRules: [],

  currentDate: new Date(), // 선택된 월을 나타내는 기준 날짜 (전 탭 공용)
  activeTab: "home", // 'home' | 'budget' | 'settings'

  memberFilter: "all",
  filters: { type: "all", category: "all", search: "" },

  editingId: null, // 거래 수정 대상 id
  currentType: "expense", // 거래 모달의 현재 유형

  editingBudgetId: null,
  recurringType: "expense", // 반복 거래 모달의 현재 유형
};

/* ---------------- Storage ---------------- */

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    console.error(`${key} 데이터를 불러오지 못했습니다.`, err);
    return fallback;
  }
}

function saveJSON(key, value, failMessage) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`${key} 데이터를 저장하지 못했습니다.`, err);
    showToast(failMessage || "저장에 실패했어요. 브라우저 저장 공간을 확인해 주세요.");
  }
}

function loadTransactions() {
  const parsed = loadJSON(STORAGE_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}
function saveTransactions() {
  saveJSON(STORAGE_KEY, state.transactions);
}

function loadMembers() {
  const parsed = loadJSON(MEMBERS_KEY, null);
  if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  return DEFAULT_MEMBERS.map((name) => ({ name, hidden: false }));
}
function saveMembers() {
  saveJSON(MEMBERS_KEY, state.members);
}

function loadCategories() {
  const parsed = loadJSON(CATEGORIES_KEY, null);
  if (parsed && Array.isArray(parsed.income) && Array.isArray(parsed.expense)) {
    // 이전 단계 데이터에는 kind가 없을 수 있으므로, 없으면 기본값으로 보정한다(마이그레이션).
    for (const type of ["income", "expense"]) {
      for (const g of parsed[type] || []) {
        for (const s of g.subs || []) {
          if (s.kind !== "consumption" && s.kind !== "asset_transfer") {
            s.kind = defaultKindFor(type, g.group, s.name);
          }
        }
      }
    }
    // 새로 추가된 기본 소분류 중, 같은 유형에 아직 없는 이름만 안전하게 보충한다.
    for (const type of ["income", "expense"]) {
      const existingNames = new Set();
      for (const g of parsed[type] || []) {
        for (const s of g.subs || []) existingNames.add(s.name.toLowerCase());
      }
      for (const addition of NEW_CATEGORY_ADDITIONS[type]) {
        if (existingNames.has(addition.name.toLowerCase())) continue;
        const g = (parsed[type] || []).find((x) => x.group === addition.group);
        if (!g) continue;
        g.subs.push({ name: addition.name, hidden: false, kind: defaultKindFor(type, addition.group, addition.name) });
        existingNames.add(addition.name.toLowerCase());
      }
    }
    return parsed;
  }
  const clone = (type) =>
    DEFAULT_CATEGORIES[type].map((g) => ({
      group: g.group,
      subs: g.subs.map((name) => ({ name, hidden: false, kind: defaultKindFor(type, g.group, name) })),
    }));
  return { income: clone("income"), expense: clone("expense") };
}
function saveCategories() {
  saveJSON(CATEGORIES_KEY, state.categories);
}

function loadBudgets() {
  const parsed = loadJSON(BUDGETS_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}
function saveBudgets() {
  saveJSON(BUDGETS_KEY, state.budgets);
}

function loadRecurringRules() {
  const parsed = loadJSON(RECURRING_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}
function saveRecurringRules() {
  saveJSON(RECURRING_KEY, state.recurringRules);
}

/* ---------------- Utils ---------------- */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatWon(amount) {
  return `${Math.round(Number(amount) || 0).toLocaleString("ko-KR")}원`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toDateInputValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function isSameMonth(dateStr, refDate) {
  const d = new Date(dateStr);
  return d.getFullYear() === refDate.getFullYear() && d.getMonth() === refDate.getMonth();
}

function categoryKeyOf(t) {
  return `${t.type}::${t.group}::${t.category}`;
}

/* ---------------- Member / Category helpers ---------------- */

function getVisibleMembers() {
  return state.members.filter((m) => !m.hidden).map((m) => m.name);
}

function getSelectableMembers(currentValue) {
  const list = getVisibleMembers();
  if (currentValue && !list.includes(currentValue)) list.push(currentValue);
  if (list.length === 0) return state.members.map((m) => m.name);
  return list;
}

function getSelectableGroups(type, currentGroup) {
  const all = state.categories[type] || [];
  const allNames = all.map((g) => g.group);
  let groups = all.filter((g) => g.subs.some((s) => !s.hidden)).map((g) => g.group);
  // currentGroup은 그 유형에 실제로 존재하는 그룹일 때만 주입한다.
  // (유형/그룹 전환 도중 남아있는 이전 선택값이 엉뚱한 그룹으로 새어 들어가는 것을 방지)
  if (currentGroup && allNames.includes(currentGroup) && !groups.includes(currentGroup)) {
    groups.push(currentGroup);
  }
  if (groups.length === 0) groups = allNames;
  return groups;
}

function getSelectableSubs(type, group, currentValue) {
  const g = (state.categories[type] || []).find((x) => x.group === group);
  if (!g) return [];
  const allNames = g.subs.map((s) => s.name);
  let subs = g.subs.filter((s) => !s.hidden).map((s) => s.name);
  // currentValue는 이 그룹에 실제로 속한 소분류(숨김 포함)일 때만 주입한다.
  // (다른 그룹에서 남은 선택값이 잘못 섞여 들어가지 않도록 방지)
  if (currentValue && allNames.includes(currentValue) && !subs.includes(currentValue)) {
    subs.push(currentValue);
  }
  if (subs.length === 0) subs = allNames;
  return subs;
}

function getVisibleExpenseCategoryNames() {
  const names = [];
  for (const g of state.categories.expense) {
    for (const s of g.subs) {
      if (!s.hidden) names.push(s.name);
    }
  }
  return names;
}

/* ---------------- DOM refs ---------------- */

const el = {
  monthLabel: document.getElementById("monthLabel"),
  prevMonth: document.getElementById("prevMonth"),
  nextMonth: document.getElementById("nextMonth"),
  tabButtons: Array.from(document.querySelectorAll(".tab-btn")),
  homeTab: document.getElementById("homeTab"),
  budgetTab: document.getElementById("budgetTab"),
  analyticsTab: document.getElementById("analyticsTab"),
  settingsTab: document.getElementById("settingsTab"),

  memberFilter: document.getElementById("memberFilter"),
  remainingAmount: document.getElementById("remainingAmount"),
  totalIncome: document.getElementById("totalIncome"),
  totalExpense: document.getElementById("totalExpense"),

  searchInput: document.getElementById("searchInput"),
  typeFilter: document.getElementById("typeFilter"),
  categoryFilter: document.getElementById("categoryFilter"),
  resetFilters: document.getElementById("resetFilters"),
  filterSummary: document.getElementById("filterSummary"),

  transactionList: document.getElementById("transactionList"),
  emptyState: document.getElementById("emptyState"),
  addFab: document.getElementById("addFab"),

  // 거래 모달
  modalOverlay: document.getElementById("modalOverlay"),
  modalTitle: document.getElementById("modalTitle"),
  closeModal: document.getElementById("closeModal"),
  transactionForm: document.getElementById("transactionForm"),
  editId: document.getElementById("editId"),
  amountInput: document.getElementById("amountInput"),
  dateInput: document.getElementById("dateInput"),
  memberInput: document.getElementById("memberInput"),
  groupInput: document.getElementById("groupInput"),
  categoryInput: document.getElementById("categoryInput"),
  contentInput: document.getElementById("contentInput"),
  memoInput: document.getElementById("memoInput"),
  formError: document.getElementById("formError"),
  submitBtn: document.getElementById("submitBtn"),
  deleteBtn: document.getElementById("deleteBtn"),
  typeButtons: Array.from(document.querySelectorAll("#transactionForm .type-btn")),

  // 예산
  overallBudgetAmount: document.getElementById("overallBudgetAmount"),
  overallBudgetMeta: document.getElementById("overallBudgetMeta"),
  overallProgressFill: document.getElementById("overallProgressFill"),
  overallBudgetSub: document.getElementById("overallBudgetSub"),
  editOverallBudgetBtn: document.getElementById("editOverallBudgetBtn"),
  addCategoryBudgetBtn: document.getElementById("addCategoryBudgetBtn"),
  categoryBudgetList: document.getElementById("categoryBudgetList"),
  categoryBudgetEmpty: document.getElementById("categoryBudgetEmpty"),

  budgetModalOverlay: document.getElementById("budgetModalOverlay"),
  budgetModalTitle: document.getElementById("budgetModalTitle"),
  closeBudgetModal: document.getElementById("closeBudgetModal"),
  budgetForm: document.getElementById("budgetForm"),
  budgetEditId: document.getElementById("budgetEditId"),
  budgetTargetInput: document.getElementById("budgetTargetInput"),
  budgetCategoryOptions: document.getElementById("budgetCategoryOptions"),
  budgetAmountInput: document.getElementById("budgetAmountInput"),
  budgetFormError: document.getElementById("budgetFormError"),
  budgetDeleteBtn: document.getElementById("budgetDeleteBtn"),

  // 분석
  consumptionTotal: document.getElementById("consumptionTotal"),
  momDiff: document.getElementById("momDiff"),
  assetTransferTotal: document.getElementById("assetTransferTotal"),
  categoryBreakdown: document.getElementById("categoryBreakdown"),
  categoryBreakdownEmpty: document.getElementById("categoryBreakdownEmpty"),
  memberBreakdown: document.getElementById("memberBreakdown"),
  memberBreakdownEmpty: document.getElementById("memberBreakdownEmpty"),
  groupComparison: document.getElementById("groupComparison"),
  trendList: document.getElementById("trendList"),

  // 설정
  memberManageList: document.getElementById("memberManageList"),
  newMemberInput: document.getElementById("newMemberInput"),
  addMemberBtn: document.getElementById("addMemberBtn"),
  categoryManageGroups: document.getElementById("categoryManageGroups"),

  addRecurringBtn: document.getElementById("addRecurringBtn"),
  recurringList: document.getElementById("recurringList"),
  recurringEmpty: document.getElementById("recurringEmpty"),

  recurringModalOverlay: document.getElementById("recurringModalOverlay"),
  closeRecurringModal: document.getElementById("closeRecurringModal"),
  recurringForm: document.getElementById("recurringForm"),
  recurringAmountInput: document.getElementById("recurringAmountInput"),
  recurringStartInput: document.getElementById("recurringStartInput"),
  recurringEndInput: document.getElementById("recurringEndInput"),
  recurringDayInput: document.getElementById("recurringDayInput"),
  recurringMemberInput: document.getElementById("recurringMemberInput"),
  recurringGroupInput: document.getElementById("recurringGroupInput"),
  recurringCategoryInput: document.getElementById("recurringCategoryInput"),
  recurringContentInput: document.getElementById("recurringContentInput"),
  recurringMemoInput: document.getElementById("recurringMemoInput"),
  recurringFormError: document.getElementById("recurringFormError"),
  recurringSubmitBtn: document.getElementById("recurringSubmitBtn"),
  recurringTypeButtons: Array.from(document.querySelectorAll("#recurringForm .type-btn")),

  toast: document.getElementById("toast"),
};

/* ---------------- Category picker (거래 모달 / 반복 모달 공용) ---------------- */

function createCategoryPicker({ groupSelect, categorySelect, typeButtons, getType, setType }) {
  // desiredGroup/desiredCategory가 주어지지 않으면(=사용자가 직접 유형/그룹을 바꾼 경우)
  // 항상 해당 그룹의 첫 번째 항목으로 리셋한다. 이전 선택값이 새 그룹으로 새어 들어가는 것을 막기 위함.
  function populateGroups(desiredGroup) {
    const type = getType();
    const groups = getSelectableGroups(type, desiredGroup);
    groupSelect.innerHTML = "";
    for (const g of groups) {
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      groupSelect.appendChild(opt);
    }
    if (desiredGroup && groups.includes(desiredGroup)) groupSelect.value = desiredGroup;
    populateCategories();
  }

  function populateCategories(desiredCategory) {
    const type = getType();
    const group = groupSelect.value;
    const subs = getSelectableSubs(type, group, desiredCategory);
    categorySelect.innerHTML = "";
    for (const s of subs) {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      categorySelect.appendChild(opt);
    }
    if (desiredCategory && subs.includes(desiredCategory)) categorySelect.value = desiredCategory;
  }

  function selectType(newType) {
    setType(newType);
    for (const btn of typeButtons) btn.classList.toggle("active", btn.dataset.type === newType);
    populateGroups();
  }

  // 거래 수정처럼 이미 알고 있는 (유형, 그룹, 소분류) 조합을 그대로 복원할 때 사용.
  // 숨김 처리된 소분류라도 기존 데이터를 안전하게 표시하기 위해 명시적으로 값을 지정한다.
  function setValue(type, group, category) {
    setType(type);
    for (const btn of typeButtons) btn.classList.toggle("active", btn.dataset.type === type);
    populateGroups(group);
    populateCategories(category);
  }

  groupSelect.addEventListener("change", () => populateCategories());
  for (const btn of typeButtons) {
    btn.addEventListener("click", () => selectType(btn.dataset.type));
  }

  return { populateGroups, populateCategories, selectType, setValue };
}

const transactionPicker = createCategoryPicker({
  groupSelect: el.groupInput,
  categorySelect: el.categoryInput,
  typeButtons: el.typeButtons,
  getType: () => state.currentType,
  setType: (t) => (state.currentType = t),
});

const recurringPicker = createCategoryPicker({
  groupSelect: el.recurringGroupInput,
  categorySelect: el.recurringCategoryInput,
  typeButtons: el.recurringTypeButtons,
  getType: () => state.recurringType,
  setType: (t) => (state.recurringType = t),
});

function populateMemberSelect(selectEl, currentValue) {
  const list = getSelectableMembers(currentValue);
  selectEl.innerHTML = "";
  for (const name of list) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    selectEl.appendChild(opt);
  }
  if (currentValue && list.includes(currentValue)) selectEl.value = currentValue;
}

/* ---------------- Recurring generation ---------------- */

function enumerateMonths(startMonth, endMonth) {
  const months = [];
  let [y, m] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard < 1200) {
    months.push(`${y}-${pad2(m)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    guard += 1;
  }
  return months;
}

function clampDayInMonth(monthKey, day) {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return Math.min(day, lastDay);
}

function generateRecurringOccurrences() {
  let txChanged = false;
  let ruleChanged = false;

  for (const rule of state.recurringRules) {
    if (!Array.isArray(rule.generatedMonths)) rule.generatedMonths = [];
    const months = enumerateMonths(rule.startMonth, rule.endMonth);
    for (const m of months) {
      if (rule.generatedMonths.includes(m)) continue; // 이미 생성된 달 → 중복 생성 방지
      const day = clampDayInMonth(m, rule.dayOfMonth);
      state.transactions.push({
        id: uid(),
        type: rule.type,
        amount: rule.amount,
        date: `${m}-${pad2(day)}`,
        member: rule.member,
        group: rule.group,
        category: rule.category,
        content: rule.content || "",
        memo: rule.memo || "",
        status: "completed",
        recurringId: rule.id,
        occurrenceMonth: m,
        createdAt: Date.now(),
      });
      rule.generatedMonths.push(m);
      txChanged = true;
      ruleChanged = true;
    }
  }

  if (txChanged) saveTransactions();
  if (ruleChanged) saveRecurringRules();
}

/* ---------------- Rendering: 공통 ---------------- */

function renderMonthLabel() {
  el.monthLabel.textContent = `${state.currentDate.getFullYear()}년 ${state.currentDate.getMonth() + 1}월`;
}

function renderTabs() {
  el.homeTab.hidden = state.activeTab !== "home";
  el.budgetTab.hidden = state.activeTab !== "budget";
  el.analyticsTab.hidden = state.activeTab !== "analytics";
  el.settingsTab.hidden = state.activeTab !== "settings";
  for (const btn of el.tabButtons) {
    btn.classList.toggle("active", btn.dataset.tab === state.activeTab);
  }
  el.addFab.hidden = state.activeTab !== "home";
}

function render() {
  renderMonthLabel();
  renderTabs();
  if (state.activeTab === "home") renderHome();
  else if (state.activeTab === "budget") renderBudget();
  else if (state.activeTab === "analytics") renderAnalytics();
  else renderSettings();
}

/* ---------------- Rendering: 홈 ---------------- */

function renderMemberFilter() {
  el.memberFilter.innerHTML = "";
  const options = [{ key: "all", label: "전체" }, ...getVisibleMembers().map((name) => ({ key: name, label: name }))];
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "member-chip" + (state.memberFilter === opt.key ? " active" : "");
    btn.textContent = opt.label;
    btn.addEventListener("click", () => {
      state.memberFilter = opt.key;
      render();
    });
    el.memberFilter.appendChild(btn);
  }
}

function getMonthTransactions() {
  return state.transactions.filter((t) => {
    if (!isSameMonth(t.date, state.currentDate)) return false;
    if (state.memberFilter !== "all" && t.member !== state.memberFilter) return false;
    return true;
  });
}

function getFilteredListTransactions(monthTx) {
  const { type, category, search } = state.filters;
  const q = search.trim().toLowerCase();
  return monthTx.filter((t) => {
    if (type !== "all" && t.type !== type) return false;
    if (category !== "all" && categoryKeyOf(t) !== category) return false;
    if (q) {
      const hay = `${t.content || ""} ${t.memo || ""} ${t.category || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderSummary(monthTx) {
  const completed = monthTx.filter((t) => t.status !== "pending");
  const totalIncome = completed.filter((t) => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
  const totalExpense = completed.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
  const remaining = totalIncome - totalExpense;

  el.totalIncome.textContent = formatWon(totalIncome);
  el.totalExpense.textContent = formatWon(totalExpense);
  el.remainingAmount.textContent = formatWon(remaining);
}

function populateCategoryFilterOptions() {
  const type = el.typeFilter.value || "all";
  const prev = el.categoryFilter.value;
  el.categoryFilter.innerHTML = '<option value="all">전체 카테고리</option>';

  const types = type === "all" ? ["expense", "income"] : [type];
  for (const t of types) {
    for (const g of state.categories[t]) {
      const visibleSubs = g.subs.filter((s) => !s.hidden);
      if (visibleSubs.length === 0) continue;
      const optgroup = document.createElement("optgroup");
      optgroup.label = `${TYPE_LABEL[t]} · ${g.group}`;
      for (const s of visibleSubs) {
        const opt = document.createElement("option");
        opt.value = `${t}::${g.group}::${s.name}`;
        opt.textContent = s.name;
        optgroup.appendChild(opt);
      }
      el.categoryFilter.appendChild(optgroup);
    }
  }

  const values = Array.from(el.categoryFilter.options).map((o) => o.value);
  if (values.includes(prev)) {
    el.categoryFilter.value = prev;
  } else {
    el.categoryFilter.value = "all";
    state.filters.category = "all";
  }
}

function renderFilterSummary(filteredTx) {
  const income = filteredTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = filteredTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  el.filterSummary.textContent = `${filteredTx.length}건 · 수입 +${formatWon(income)} · 지출 -${formatWon(expense)}`;
}

function renderTransactionList(monthTx, filteredTx) {
  const sorted = [...filteredTx].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.createdAt - a.createdAt;
  });

  el.transactionList.innerHTML = "";

  if (sorted.length === 0) {
    el.emptyState.textContent =
      monthTx.length === 0 ? "이번 달 등록된 거래가 없어요." : "조건에 맞는 거래가 없어요.";
    el.emptyState.hidden = false;
    return;
  }
  el.emptyState.hidden = true;

  for (const t of sorted) {
    const li = document.createElement("li");
    li.className = "transaction-item";
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.setAttribute("aria-label", `${t.date} ${t.category} ${formatWon(t.amount)} 수정`);

    const left = document.createElement("div");
    left.className = "tx-left";

    const title = document.createElement("span");
    title.className = "tx-title";
    title.textContent = (t.content ? t.content : t.category) + (t.recurringId ? " 🔁" : "");

    const meta = document.createElement("span");
    meta.className = "tx-meta";
    const d = new Date(t.date);
    meta.textContent = `${d.getMonth() + 1}.${d.getDate()} · ${t.member} · ${t.group} · ${t.category}`;

    left.appendChild(title);
    left.appendChild(meta);

    const amount = document.createElement("span");
    amount.className = `tx-amount ${t.type}`;
    amount.textContent = `${t.type === "income" ? "+" : "-"}${formatWon(t.amount)}`;

    li.appendChild(left);
    li.appendChild(amount);

    li.addEventListener("click", () => openEditModal(t.id));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openEditModal(t.id);
      }
    });

    el.transactionList.appendChild(li);
  }
}

function renderHome() {
  renderMemberFilter();
  populateCategoryFilterOptions();

  const monthTx = getMonthTransactions();
  renderSummary(monthTx);

  const filteredTx = getFilteredListTransactions(monthTx);
  renderFilterSummary(filteredTx);
  renderTransactionList(monthTx, filteredTx);
}

/* ---------------- Rendering: 예산 ---------------- */

function renderBudget() {
  const monthKey = getMonthKey(state.currentDate);
  const monthExpense = state.transactions.filter(
    (t) => t.type === "expense" && t.status !== "pending" && t.date.slice(0, 7) === monthKey
  );

  // 전체 예산
  const overall = state.budgets.find((b) => b.month === monthKey && b.categoryKey === null);
  const overallUsage = monthExpense.reduce((s, t) => s + t.amount, 0);

  if (overall) {
    const percent = Math.round((overallUsage / overall.amount) * 100);
    const remaining = overall.amount - overallUsage;
    const over = overallUsage > overall.amount;
    el.overallBudgetAmount.textContent = formatWon(overall.amount);
    el.overallBudgetMeta.hidden = false;
    el.overallProgressFill.style.width = `${Math.min(percent, 100)}%`;
    el.overallProgressFill.classList.toggle("over-budget", over);
    el.overallBudgetSub.textContent = over
      ? `${formatWon(overallUsage)} 사용 · ${formatWon(-remaining)} 예산 초과 (${percent}%)`
      : `${formatWon(overallUsage)} 사용 · ${formatWon(remaining)} 남음 (${percent}%)`;
    el.overallBudgetSub.classList.toggle("over-budget", over);
    el.editOverallBudgetBtn.textContent = "수정";
  } else {
    el.overallBudgetAmount.textContent = "미설정";
    el.overallBudgetMeta.hidden = true;
    el.editOverallBudgetBtn.textContent = "설정";
  }

  // 카테고리별 예산
  const categoryBudgets = state.budgets
    .filter((b) => b.month === monthKey && b.categoryKey !== null)
    .sort((a, b) => a.categoryKey.localeCompare(b.categoryKey, "ko"));

  el.categoryBudgetList.innerHTML = "";
  el.categoryBudgetEmpty.hidden = categoryBudgets.length > 0;

  for (const b of categoryBudgets) {
    const usage = monthExpense.filter((t) => t.category === b.categoryKey).reduce((s, t) => s + t.amount, 0);
    const percent = Math.round((usage / b.amount) * 100);
    const remaining = b.amount - usage;
    const over = usage > b.amount;

    const li = document.createElement("li");
    li.className = "manage-row budget-row";
    li.tabIndex = 0;
    li.setAttribute("role", "button");

    li.innerHTML = `
      <div class="budget-row-top">
        <span class="manage-row-title">${escapeHTML(b.categoryKey)}</span>
        <span class="budget-row-amount">
          <span class="amount-used${over ? " over-budget" : ""}">${formatWon(usage)}</span>
          <span class="amount-total"> / ${formatWon(b.amount)}</span>
        </span>
      </div>
      <div class="progress-bar"><div class="progress-fill${over ? " over-budget" : ""}" style="width:${Math.min(percent, 100)}%"></div></div>
      <p class="budget-sub${over ? " over-budget" : ""}">${over ? `${formatWon(-remaining)} 초과` : `${formatWon(remaining)} 남음`} · ${percent}% 사용</p>
    `;

    li.addEventListener("click", () => openBudgetEditModal(b));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openBudgetEditModal(b);
      }
    });

    el.categoryBudgetList.appendChild(li);
  }
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

/* ---------------- Rendering: 분석 ---------------- */

function isAssetTransferCategory(group, categoryName) {
  const g = state.categories.expense.find((x) => x.group === group);
  if (!g) return false;
  const s = g.subs.find((x) => x.name === categoryName);
  return !!s && s.kind === "asset_transfer";
}

function shiftMonth(date, offset) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function sumAmount(list) {
  return list.reduce((sum, t) => sum + t.amount, 0);
}

function getExpenseTransactionsForMonth(refDate) {
  return state.transactions.filter(
    (t) => t.type === "expense" && t.status !== "pending" && isSameMonth(t.date, refDate)
  );
}

// 저축·투자는 실제 소비가 아닌 자산 이동이므로 소비 분석에서는 분리해서 집계한다.
// (남은 돈 계산에는 계속 지출로 포함되며, 이 분리는 renderAnalytics에서만 사용된다.)
function splitConsumption(expenseTx) {
  const consumption = [];
  const assetTransfer = [];
  for (const t of expenseTx) {
    (isAssetTransferCategory(t.group, t.category) ? assetTransfer : consumption).push(t);
  }
  return { consumption, assetTransfer };
}

function groupSum(list, keyFn) {
  const map = new Map();
  for (const t of list) {
    const key = keyFn(t);
    map.set(key, (map.get(key) || 0) + t.amount);
  }
  return Array.from(map.entries()).map(([label, amount]) => ({ label, amount }));
}

function renderRatioList(container, emptyEl, entries, total) {
  container.innerHTML = "";
  if (entries.length === 0 || total === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  const sorted = [...entries].sort((a, b) => b.amount - a.amount);
  for (const e of sorted) {
    const percent = Math.round((e.amount / total) * 100);
    const row = document.createElement("div");
    row.className = "stat-row";
    row.innerHTML = `
      <div class="stat-row-top">
        <span class="stat-row-name">${escapeHTML(e.label)}</span>
        <span class="stat-row-value">${formatWon(e.amount)} · ${percent}%</span>
      </div>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.min(percent, 100)}%"></div></div>
    `;
    container.appendChild(row);
  }
}

function renderMomCard(current, prev, assetTransferTotal) {
  el.consumptionTotal.textContent = formatWon(current);

  if (prev === 0 && current === 0) {
    el.momDiff.textContent = "지난달과 이번 달 모두 소비 내역이 없어요.";
    el.momDiff.className = "mom-diff";
  } else if (prev === 0) {
    el.momDiff.textContent = "전월 소비 내역이 없어 비교할 수 없어요.";
    el.momDiff.className = "mom-diff";
  } else {
    const diff = current - prev;
    const percent = Math.round((Math.abs(diff) / prev) * 100);
    if (diff > 0) {
      el.momDiff.textContent = `▲ 전월 대비 ${formatWon(diff)} 증가 (${percent}%)`;
      el.momDiff.className = "mom-diff up";
    } else if (diff < 0) {
      el.momDiff.textContent = `▼ 전월 대비 ${formatWon(-diff)} 감소 (${percent}%)`;
      el.momDiff.className = "mom-diff down";
    } else {
      el.momDiff.textContent = "전월과 소비 금액이 동일해요.";
      el.momDiff.className = "mom-diff";
    }
  }

  el.assetTransferTotal.textContent = `저축·투자 (소비 제외, 별도 집계): ${formatWon(assetTransferTotal)}`;
}

function renderGroupComparison(consumption) {
  const fixedTotal = sumAmount(consumption.filter((t) => t.group === "고정지출"));
  const personalTotal = sumAmount(consumption.filter((t) => t.group === "개인지출"));

  if (fixedTotal === 0 && personalTotal === 0) {
    el.groupComparison.innerHTML = `<p class="empty-state">이번 달 소비 내역이 없어요.</p>`;
    return;
  }

  const max = Math.max(fixedTotal, personalTotal, 1);
  el.groupComparison.innerHTML = `
    <div class="stat-row">
      <div class="stat-row-top"><span class="stat-row-name">고정지출</span><span class="stat-row-value">${formatWon(fixedTotal)}</span></div>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(fixedTotal / max) * 100}%"></div></div>
    </div>
    <div class="stat-row">
      <div class="stat-row-top"><span class="stat-row-name">개인지출</span><span class="stat-row-value">${formatWon(personalTotal)}</span></div>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(personalTotal / max) * 100}%"></div></div>
    </div>
  `;
}

function renderTrend() {
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(shiftMonth(state.currentDate, -i));

  el.trendList.innerHTML = "";
  for (const d of months) {
    const tx = state.transactions.filter((t) => isSameMonth(t.date, d) && t.status !== "pending");
    const income = sumAmount(tx.filter((t) => t.type === "income"));
    const expense = sumAmount(tx.filter((t) => t.type === "expense"));
    const remaining = income - expense;
    const barPercent = income > 0 ? Math.min(Math.round((expense / income) * 100), 100) : expense > 0 ? 100 : 0;

    const row = document.createElement("div");
    row.className = "trend-row";
    row.innerHTML = `
      <div class="trend-head">
        <span class="trend-month">${d.getFullYear()}.${pad2(d.getMonth() + 1)}</span>
        <span class="trend-remaining${remaining < 0 ? " over-budget" : ""}">${remaining >= 0 ? "+" : ""}${formatWon(remaining)}</span>
      </div>
      <div class="trend-numbers">수입 ${formatWon(income)} · 지출 ${formatWon(expense)}</div>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${barPercent}%"></div></div>
    `;
    el.trendList.appendChild(row);
  }
}

function renderAnalytics() {
  const expenseTx = getExpenseTransactionsForMonth(state.currentDate);
  const { consumption, assetTransfer } = splitConsumption(expenseTx);
  const consumptionTotal = sumAmount(consumption);
  const assetTransferTotal = sumAmount(assetTransfer);

  const prevDate = shiftMonth(state.currentDate, -1);
  const prevConsumption = splitConsumption(getExpenseTransactionsForMonth(prevDate)).consumption;
  const prevTotal = sumAmount(prevConsumption);

  renderMomCard(consumptionTotal, prevTotal, assetTransferTotal);
  renderRatioList(el.categoryBreakdown, el.categoryBreakdownEmpty, groupSum(consumption, (t) => t.category), consumptionTotal);
  renderRatioList(el.memberBreakdown, el.memberBreakdownEmpty, groupSum(consumption, (t) => t.member), consumptionTotal);
  renderGroupComparison(consumption);
  renderTrend();
}

/* ---------------- Budget modal ---------------- */

function populateBudgetTargetOptions() {
  el.budgetCategoryOptions.innerHTML = "";
  for (const name of getVisibleExpenseCategoryNames()) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    el.budgetCategoryOptions.appendChild(opt);
  }
}

function openBudgetAddModal(presetCategoryKey) {
  state.editingBudgetId = null;
  el.budgetModalTitle.textContent = "예산 추가";
  el.budgetEditId.value = "";
  el.budgetForm.reset();
  populateBudgetTargetOptions();
  el.budgetTargetInput.disabled = false;
  el.budgetTargetInput.value = presetCategoryKey || "";
  el.budgetAmountInput.value = "";
  el.budgetDeleteBtn.hidden = true;
  el.budgetFormError.hidden = true;
  el.budgetModalOverlay.hidden = false;
  el.budgetAmountInput.focus();
}

function openBudgetEditModal(budget) {
  state.editingBudgetId = budget.id;
  el.budgetModalTitle.textContent = "예산 수정";
  el.budgetEditId.value = budget.id;
  populateBudgetTargetOptions();
  el.budgetTargetInput.value = budget.categoryKey === null ? "" : budget.categoryKey;
  el.budgetTargetInput.disabled = true;
  el.budgetAmountInput.value = budget.amount;
  el.budgetDeleteBtn.hidden = false;
  el.budgetFormError.hidden = true;
  el.budgetModalOverlay.hidden = false;
}

function closeBudgetModal() {
  el.budgetModalOverlay.hidden = true;
  state.editingBudgetId = null;
}

function handleBudgetSubmit(e) {
  e.preventDefault();
  const amount = Number(el.budgetAmountInput.value);
  if (!el.budgetAmountInput.value || !Number.isInteger(amount) || amount < 1) {
    el.budgetFormError.textContent = "예산 금액은 1원 이상의 숫자로 입력해 주세요.";
    el.budgetFormError.hidden = false;
    return;
  }
  el.budgetFormError.hidden = true;

  const monthKey = getMonthKey(state.currentDate);
  const categoryKey = el.budgetTargetInput.value === "" ? null : el.budgetTargetInput.value;

  if (state.editingBudgetId) {
    const b = state.budgets.find((x) => x.id === state.editingBudgetId);
    if (b) b.amount = amount;
    showToast("예산을 수정했어요.");
  } else {
    const existing = state.budgets.find((x) => x.month === monthKey && x.categoryKey === categoryKey);
    if (existing) {
      existing.amount = amount;
      showToast("예산을 수정했어요.");
    } else {
      state.budgets.push({ id: uid(), month: monthKey, categoryKey, amount, createdAt: Date.now() });
      showToast("예산을 추가했어요.");
    }
  }

  saveBudgets();
  closeBudgetModal();
  render();
}

function handleBudgetDelete() {
  if (!state.editingBudgetId) return;
  const ok = confirm("이 예산을 삭제할까요?");
  if (!ok) return;
  state.budgets = state.budgets.filter((x) => x.id !== state.editingBudgetId);
  saveBudgets();
  showToast("예산을 삭제했어요.");
  closeBudgetModal();
  render();
}

/* ---------------- Rendering: 설정 ---------------- */

function renderSettings() {
  renderMemberManageList();
  renderCategoryManageGroups();
  renderRecurringList();
}

function renderMemberManageList() {
  el.memberManageList.innerHTML = "";
  for (const m of state.members) {
    const li = document.createElement("li");
    li.className = "manage-row";
    li.innerHTML = `
      <span class="manage-row-title">${escapeHTML(m.name)}${m.hidden ? ' <span class="hidden-tag">숨김</span>' : ""}</span>
      <span class="row-actions">
        <button type="button" class="link-btn" data-action="rename">수정</button>
        <button type="button" class="link-btn" data-action="toggle">${m.hidden ? "표시" : "숨기기"}</button>
      </span>
    `;
    li.querySelector('[data-action="rename"]').addEventListener("click", () => handleRenameMember(m));
    li.querySelector('[data-action="toggle"]').addEventListener("click", () => handleToggleMemberHidden(m));
    el.memberManageList.appendChild(li);
  }
}

function handleAddMember() {
  const name = el.newMemberInput.value.trim();
  if (!name) return;
  const dup = state.members.some((m) => m.name.toLowerCase() === name.toLowerCase());
  if (dup) {
    showToast("이미 있는 사용자 이름이에요.");
    return;
  }
  state.members.push({ name, hidden: false });
  saveMembers();
  el.newMemberInput.value = "";
  showToast("사용자를 추가했어요.");
  render();
}

function handleRenameMember(m) {
  const next = prompt("사용자 이름 수정", m.name);
  if (next === null) return;
  const name = next.trim();
  if (!name) return;
  const dup = state.members.some((x) => x !== m && x.name.toLowerCase() === name.toLowerCase());
  if (dup) {
    showToast("이미 있는 사용자 이름이에요.");
    return;
  }
  if (name === m.name) return;

  const oldName = m.name;
  m.name = name;
  for (const t of state.transactions) {
    if (t.member === oldName) t.member = name;
  }
  for (const r of state.recurringRules) {
    if (r.member === oldName) r.member = name;
  }
  saveMembers();
  saveTransactions();
  saveRecurringRules();
  showToast("사용자 이름을 수정했어요.");
  render();
}

function handleToggleMemberHidden(m) {
  m.hidden = !m.hidden;
  saveMembers();
  render();
}

function renderCategoryManageGroups() {
  el.categoryManageGroups.innerHTML = "";
  for (const type of ["expense", "income"]) {
    for (const g of state.categories[type]) {
      const block = document.createElement("div");
      block.className = "group-block";

      const title = document.createElement("p");
      title.className = "group-title";
      title.innerHTML = `<span>${TYPE_LABEL[type]} · ${escapeHTML(g.group)}</span>`;
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "link-btn";
      addBtn.textContent = "+ 추가";
      addBtn.addEventListener("click", () => handleAddSub(type, g));
      title.appendChild(addBtn);
      block.appendChild(title);

      const list = document.createElement("ul");
      list.className = "manage-list";
      for (const s of g.subs) {
        const li = document.createElement("li");
        li.className = "manage-row";
        li.innerHTML = `
          <span class="manage-row-title">${escapeHTML(s.name)}${s.hidden ? ' <span class="hidden-tag">숨김</span>' : ""}</span>
          <span class="row-actions">
            <button type="button" class="link-btn" data-action="rename">수정</button>
            <button type="button" class="link-btn" data-action="toggle">${s.hidden ? "표시" : "숨기기"}</button>
          </span>
        `;
        li.querySelector('[data-action="rename"]').addEventListener("click", () => handleRenameSub(type, g, s));
        li.querySelector('[data-action="toggle"]').addEventListener("click", () => handleToggleSubHidden(s));
        list.appendChild(li);
      }
      block.appendChild(list);
      el.categoryManageGroups.appendChild(block);
    }
  }
}

function isSubNameTaken(type, name, exceptSub) {
  const lower = name.toLowerCase();
  for (const g of state.categories[type]) {
    for (const s of g.subs) {
      if (s !== exceptSub && s.name.toLowerCase() === lower) return true;
    }
  }
  return false;
}

function handleAddSub(type, group) {
  const input = prompt(`${TYPE_LABEL[type]} · ${group.group}에 추가할 소분류 이름`);
  if (input === null) return;
  const name = input.trim();
  if (!name) return;
  if (isSubNameTaken(type, name, null)) {
    showToast("이미 있는 소분류 이름이에요.");
    return;
  }
  group.subs.push({ name, hidden: false, kind: "consumption" });
  saveCategories();
  showToast("소분류를 추가했어요.");
  render();
}

function handleRenameSub(type, group, sub) {
  const input = prompt("소분류 이름 수정", sub.name);
  if (input === null) return;
  const name = input.trim();
  if (!name) return;
  if (isSubNameTaken(type, name, sub)) {
    showToast("이미 있는 소분류 이름이에요.");
    return;
  }
  if (name === sub.name) return;

  const oldName = sub.name;
  sub.name = name;
  for (const t of state.transactions) {
    if (t.type === type && t.group === group.group && t.category === oldName) t.category = name;
  }
  for (const r of state.recurringRules) {
    if (r.type === type && r.group === group.group && r.category === oldName) r.category = name;
  }
  if (type === "expense") {
    for (const b of state.budgets) {
      if (b.categoryKey === oldName) b.categoryKey = name;
    }
    saveBudgets();
  }
  saveCategories();
  saveTransactions();
  saveRecurringRules();
  showToast("소분류 이름을 수정했어요.");
  render();
}

function handleToggleSubHidden(sub) {
  sub.hidden = !sub.hidden;
  saveCategories();
  render();
}

function renderRecurringList() {
  el.recurringList.innerHTML = "";
  const sorted = [...state.recurringRules].sort((a, b) => b.createdAt - a.createdAt);
  el.recurringEmpty.hidden = sorted.length > 0;

  for (const r of sorted) {
    const li = document.createElement("li");
    li.className = "manage-row";
    li.innerHTML = `
      <span class="manage-row-title">
        ${TYPE_LABEL[r.type]} · ${escapeHTML(r.content || r.category)} ${r.type === "income" ? "+" : "-"}${formatWon(r.amount)}
        <span class="manage-row-sub">${r.startMonth} ~ ${r.endMonth} · 매월 ${r.dayOfMonth}일 · ${escapeHTML(r.member)} · ${escapeHTML(r.category)}</span>
      </span>
      <span class="row-actions">
        <button type="button" class="link-btn" data-action="delete">삭제</button>
      </span>
    `;
    li.querySelector('[data-action="delete"]').addEventListener("click", () => handleDeleteRecurring(r.id));
    el.recurringList.appendChild(li);
  }
}

function handleDeleteRecurring(id) {
  const ok = confirm("이 반복 규칙을 삭제할까요? 이미 생성된 거래는 그대로 유지돼요.");
  if (!ok) return;
  state.recurringRules = state.recurringRules.filter((r) => r.id !== id);
  saveRecurringRules();
  showToast("반복 규칙을 삭제했어요.");
  render();
}

/* ---------------- 거래 추가/수정 모달 ---------------- */

function openAddModal() {
  state.editingId = null;
  el.modalTitle.textContent = "거래 추가";
  el.editId.value = "";
  el.transactionForm.reset();
  el.deleteBtn.hidden = true;
  el.formError.hidden = true;
  transactionPicker.selectType("expense");
  el.dateInput.value = toDateInputValue(new Date());
  populateMemberSelect(el.memberInput, getSelectableMembers()[0]);
  el.modalOverlay.hidden = false;
  el.amountInput.focus();
}

function openEditModal(id) {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return;
  state.editingId = id;
  el.modalTitle.textContent = "거래 수정";
  el.editId.value = id;
  el.formError.hidden = true;
  el.deleteBtn.hidden = false;

  transactionPicker.setValue(t.type, t.group, t.category);
  el.amountInput.value = t.amount;
  el.dateInput.value = t.date;
  populateMemberSelect(el.memberInput, t.member);
  el.contentInput.value = t.content || "";
  el.memoInput.value = t.memo || "";

  el.modalOverlay.hidden = false;
}

function closeModal() {
  el.modalOverlay.hidden = true;
  state.editingId = null;
}

function validateForm() {
  const amount = Number(el.amountInput.value);
  if (!el.amountInput.value || !Number.isInteger(amount) || amount < 1) {
    return "금액은 1원 이상의 숫자로 입력해 주세요.";
  }
  if (!el.dateInput.value) return "거래일을 선택해 주세요.";
  if (!el.memberInput.value) return "사용자를 선택해 주세요.";
  if (!el.groupInput.value || !el.categoryInput.value) return "카테고리를 선택해 주세요.";
  return null;
}

function handleSubmit(e) {
  e.preventDefault();

  const error = validateForm();
  if (error) {
    el.formError.textContent = error;
    el.formError.hidden = false;
    return;
  }
  el.formError.hidden = true;
  el.submitBtn.disabled = true;

  const payload = {
    type: state.currentType,
    amount: Number(el.amountInput.value),
    date: el.dateInput.value,
    member: el.memberInput.value,
    group: el.groupInput.value,
    category: el.categoryInput.value,
    content: el.contentInput.value.trim(),
    memo: el.memoInput.value.trim(),
    status: "completed",
  };

  if (state.editingId) {
    const idx = state.transactions.findIndex((x) => x.id === state.editingId);
    if (idx !== -1) state.transactions[idx] = { ...state.transactions[idx], ...payload };
    showToast("거래를 수정했어요.");
  } else {
    state.transactions.push({ id: uid(), createdAt: Date.now(), ...payload });
    showToast("거래를 추가했어요.");
  }

  saveTransactions();
  el.submitBtn.disabled = false;
  closeModal();
  render();
}

function handleDelete() {
  if (!state.editingId) return;
  const ok = confirm("이 거래를 삭제할까요?");
  if (!ok) return;
  state.transactions = state.transactions.filter((x) => x.id !== state.editingId);
  saveTransactions();
  showToast("거래를 삭제했어요.");
  closeModal();
  render();
}

/* ---------------- 반복 거래 모달 ---------------- */

function openRecurringModal() {
  el.recurringForm.reset();
  el.recurringFormError.hidden = true;
  recurringPicker.selectType("expense");
  const monthKey = getMonthKey(state.currentDate);
  el.recurringStartInput.value = monthKey;
  el.recurringEndInput.value = monthKey;
  el.recurringDayInput.value = "1";
  populateMemberSelect(el.recurringMemberInput, getSelectableMembers()[0]);
  el.recurringModalOverlay.hidden = false;
  el.recurringAmountInput.focus();
}

function closeRecurringModal() {
  el.recurringModalOverlay.hidden = true;
}

function validateRecurringForm() {
  const amount = Number(el.recurringAmountInput.value);
  if (!el.recurringAmountInput.value || !Number.isInteger(amount) || amount < 1) {
    return "금액은 1원 이상의 숫자로 입력해 주세요.";
  }
  if (!el.recurringStartInput.value || !el.recurringEndInput.value) {
    return "시작월과 종료월을 선택해 주세요.";
  }
  if (el.recurringEndInput.value < el.recurringStartInput.value) {
    return "종료월은 시작월보다 빠를 수 없어요.";
  }
  const day = Number(el.recurringDayInput.value);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return "매월 며칠은 1~31 사이 숫자로 입력해 주세요.";
  }
  if (!el.recurringMemberInput.value) return "사용자를 선택해 주세요.";
  if (!el.recurringGroupInput.value || !el.recurringCategoryInput.value) return "카테고리를 선택해 주세요.";
  return null;
}

function handleRecurringSubmit(e) {
  e.preventDefault();
  const error = validateRecurringForm();
  if (error) {
    el.recurringFormError.textContent = error;
    el.recurringFormError.hidden = false;
    return;
  }
  el.recurringFormError.hidden = true;
  el.recurringSubmitBtn.disabled = true;

  state.recurringRules.push({
    id: uid(),
    type: state.recurringType,
    amount: Number(el.recurringAmountInput.value),
    startMonth: el.recurringStartInput.value,
    endMonth: el.recurringEndInput.value,
    dayOfMonth: Number(el.recurringDayInput.value),
    member: el.recurringMemberInput.value,
    group: el.recurringGroupInput.value,
    category: el.recurringCategoryInput.value,
    content: el.recurringContentInput.value.trim(),
    memo: el.recurringMemoInput.value.trim(),
    generatedMonths: [],
    createdAt: Date.now(),
  });
  saveRecurringRules();
  generateRecurringOccurrences();

  showToast("반복 거래를 등록하고 각 달 거래를 생성했어요.");
  el.recurringSubmitBtn.disabled = false;
  closeRecurringModal();
  render();
}

/* ---------------- Toast ---------------- */

let toastTimer = null;
function showToast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 2000);
}

/* ---------------- Events ---------------- */

function bindEvents() {
  el.prevMonth.addEventListener("click", () => {
    state.currentDate = new Date(state.currentDate.getFullYear(), state.currentDate.getMonth() - 1, 1);
    render();
  });
  el.nextMonth.addEventListener("click", () => {
    state.currentDate = new Date(state.currentDate.getFullYear(), state.currentDate.getMonth() + 1, 1);
    render();
  });

  for (const btn of el.tabButtons) {
    btn.addEventListener("click", () => {
      state.activeTab = btn.dataset.tab;
      render();
    });
  }

  // 홈 필터
  el.searchInput.addEventListener("input", () => {
    state.filters.search = el.searchInput.value;
    renderHome();
  });
  el.typeFilter.addEventListener("change", () => {
    state.filters.type = el.typeFilter.value;
    renderHome();
  });
  el.categoryFilter.addEventListener("change", () => {
    state.filters.category = el.categoryFilter.value;
    renderHome();
  });
  el.resetFilters.addEventListener("click", () => {
    state.memberFilter = "all";
    state.filters = { type: "all", category: "all", search: "" };
    state.currentDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    el.searchInput.value = "";
    el.typeFilter.value = "all";
    el.categoryFilter.value = "all";
    render();
  });

  // 거래 모달
  el.addFab.addEventListener("click", openAddModal);
  el.closeModal.addEventListener("click", closeModal);
  el.modalOverlay.addEventListener("click", (e) => {
    if (e.target === el.modalOverlay) closeModal();
  });
  el.transactionForm.addEventListener("submit", handleSubmit);
  el.deleteBtn.addEventListener("click", handleDelete);

  // 예산
  el.editOverallBudgetBtn.addEventListener("click", () => {
    const monthKey = getMonthKey(state.currentDate);
    const overall = state.budgets.find((b) => b.month === monthKey && b.categoryKey === null);
    if (overall) openBudgetEditModal(overall);
    else openBudgetAddModal("");
  });
  el.addCategoryBudgetBtn.addEventListener("click", () => openBudgetAddModal(""));
  el.closeBudgetModal.addEventListener("click", closeBudgetModal);
  el.budgetModalOverlay.addEventListener("click", (e) => {
    if (e.target === el.budgetModalOverlay) closeBudgetModal();
  });
  el.budgetForm.addEventListener("submit", handleBudgetSubmit);
  el.budgetDeleteBtn.addEventListener("click", handleBudgetDelete);

  // 설정
  el.addMemberBtn.addEventListener("click", handleAddMember);
  el.newMemberInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddMember();
    }
  });

  el.addRecurringBtn.addEventListener("click", openRecurringModal);
  el.closeRecurringModal.addEventListener("click", closeRecurringModal);
  el.recurringModalOverlay.addEventListener("click", (e) => {
    if (e.target === el.recurringModalOverlay) closeRecurringModal();
  });
  el.recurringForm.addEventListener("submit", handleRecurringSubmit);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!el.modalOverlay.hidden) closeModal();
    if (!el.budgetModalOverlay.hidden) closeBudgetModal();
    if (!el.recurringModalOverlay.hidden) closeRecurringModal();
  });
}

/* ---------------- Init ---------------- */

function init() {
  state.transactions = loadTransactions();
  state.members = loadMembers();
  state.categories = loadCategories();
  state.budgets = loadBudgets();
  state.recurringRules = loadRecurringRules();

  state.currentDate = new Date(state.currentDate.getFullYear(), state.currentDate.getMonth(), 1);

  generateRecurringOccurrences();

  transactionPicker.populateGroups();
  recurringPicker.populateGroups();

  bindEvents();
  render();
}

init();
