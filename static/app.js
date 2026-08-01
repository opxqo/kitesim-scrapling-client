"use strict";

const ACCESS_STORAGE_KEY = "kitesim.relay.accessKey";
const REQUEST_TIMEOUT_MS = 30000;
const STATUS_NAMES = {
  0: "待支付",
  1: "激活中",
  2: "使用中",
  3: "已过期",
  4: "已退款",
};

const state = {
  accessKey: "",
  authenticated: false,
  status: "2",
  orders: [],
  selectedKey: "",
  messages: [],
  revealCode: false,
  showSms: false,
  loadingOrders: false,
  loadingMessages: false,
  orderRequestSequence: 0,
  messageRequestSequence: 0,
};

const elements = {
  accessView: document.querySelector("#access-view"),
  accessForm: document.querySelector("#access-form"),
  accessKey: document.querySelector("#access-key"),
  accessFeedback: document.querySelector("#access-feedback"),
  unlockButton: document.querySelector("#unlock-button"),
  passwordVisibility: document.querySelector("#password-visibility"),
  workspace: document.querySelector("#workspace"),
  connectionPill: document.querySelector("#connection-pill"),
  connectionText: document.querySelector("#connection-text"),
  lockButton: document.querySelector("#lock-button"),
  refreshButton: document.querySelector("#refresh-button"),
  syncLabel: document.querySelector("#sync-label"),
  statusTabs: document.querySelector("#status-tabs"),
  numberSelect: document.querySelector("#number-select"),
  smsToggle: document.querySelector("#sms-toggle"),
  overviewGrid: document.querySelector("#overview-grid"),
  orderStatus: document.querySelector("#order-status"),
  phoneNumber: document.querySelector("#phone-number"),
  lineCaption: document.querySelector("#line-caption"),
  countryValue: document.querySelector("#country-value"),
  packageValue: document.querySelector("#package-value"),
  expiryValue: document.querySelector("#expiry-value"),
  renewValue: document.querySelector("#renew-value"),
  codeSlots: document.querySelector("#code-slots"),
  codeNote: document.querySelector("#code-note"),
  privacyBadge: document.querySelector("#privacy-badge"),
  revealButton: document.querySelector("#reveal-button"),
  revealLabel: document.querySelector("#reveal-button span"),
  copyButton: document.querySelector("#copy-button"),
  messageCount: document.querySelector("#message-count"),
  apiIndicator: document.querySelector(".api-indicator"),
  apiLabel: document.querySelector("#api-label"),
  messageList: document.querySelector("#message-list"),
  toast: document.querySelector("#toast"),
};

class ApiError extends Error {
  constructor(message, status = 0, kind = "network") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
  }
}

function readStoredAccessKey() {
  try {
    return window.sessionStorage.getItem(ACCESS_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function storeAccessKey(value) {
  try {
    if (value) window.sessionStorage.setItem(ACCESS_STORAGE_KEY, value);
    else window.sessionStorage.removeItem(ACCESS_STORAGE_KEY);
  } catch {
    // Session storage is a convenience, not a requirement for using the page.
  }
}

function setConnection(mode, text) {
  elements.connectionPill.className = `connection-pill is-${mode}`;
  elements.connectionText.textContent = text;
}

function setApiState(mode, text) {
  elements.apiIndicator.className = `api-indicator is-${mode}`;
  elements.apiLabel.textContent = text;
}

function setAccessFeedback(text, isError = false) {
  elements.accessFeedback.textContent = text;
  elements.accessFeedback.classList.toggle("is-error", isError);
}

function showToast(text, mode = "default") {
  window.clearTimeout(showToast.timer);
  elements.toast.textContent = text;
  elements.toast.className = `toast is-visible${mode === "default" ? "" : ` is-${mode}`}`;
  showToast.timer = window.setTimeout(() => {
    elements.toast.className = "toast";
  }, 3200);
}

async function apiRequest(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (state.accessKey) headers.set("Authorization", `Bearer ${state.accessKey}`);

  try {
    const response = await fetch(path, { ...options, headers, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(
        payload.error || `请求失败（${response.status}）`,
        response.status,
        payload.kind || "http",
      );
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw new ApiError("请求超时，请再次刷新", 0, "timeout");
    if (error instanceof ApiError) throw error;
    throw new ApiError("无法连接本地或 EdgeOne 服务", 0, "network");
  } finally {
    window.clearTimeout(timeout);
  }
}

function orderKey(order) {
  return String(order?.id ?? order?.orderNo ?? "");
}

function selectedOrder() {
  return state.orders.find((order) => orderKey(order) === state.selectedKey) || null;
}

function statusName(order) {
  return order?.statusLabel || STATUS_NAMES[Number(order?.orderStatus)] || "未知状态";
}

function formatTime(value) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace("T", " ").slice(0, 16);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function createSvg(paths) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const pathData of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  }
  return svg;
}

function createEmptyState(title, detail) {
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";
  const content = document.createElement("div");
  const symbol = document.createElement("span");
  symbol.className = "empty-symbol";
  symbol.append(createSvg(["M5 7.5h14v10H5z", "M8 11h8", "M9.5 15h5"]));
  const heading = document.createElement("strong");
  heading.textContent = title;
  const copy = document.createElement("p");
  copy.textContent = detail;
  content.append(symbol, heading, copy);
  wrapper.append(content);
  return wrapper;
}

function createLoadingState() {
  const wrapper = document.createElement("div");
  wrapper.className = "loading-state";
  const content = document.createElement("div");
  const bars = document.createElement("span");
  bars.className = "loading-bars";
  bars.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
  const heading = document.createElement("strong");
  heading.textContent = "正在读取短信";
  const copy = document.createElement("p");
  copy.textContent = "只读取所选号码的最近记录";
  content.append(bars, heading, copy);
  wrapper.append(content);
  return wrapper;
}

function firstCodeRecord() {
  for (const message of state.messages) {
    if (Array.isArray(message.code) && message.code.length > 0) {
      return { code: String(message.code[0]), message };
    }
  }
  return null;
}

function renderStatusTabs() {
  for (const button of elements.statusTabs.querySelectorAll("[data-status]")) {
    const active = button.dataset.status === state.status;
    button.setAttribute("aria-pressed", String(active));
  }
}

function renderNumberSelect() {
  elements.numberSelect.replaceChildren();
  if (!state.orders.length) {
    const option = document.createElement("option");
    option.textContent = "当前状态没有号码";
    elements.numberSelect.append(option);
    return;
  }

  for (const [index, order] of state.orders.entries()) {
    const option = document.createElement("option");
    option.value = orderKey(order);
    option.textContent = `${order.phoneNumber || `号码 ${index + 1}`} · ${statusName(order)}`;
    elements.numberSelect.append(option);
  }
  elements.numberSelect.value = state.selectedKey;
}

function renderLineCard() {
  const order = selectedOrder();
  const label = order ? statusName(order) : "未同步";
  elements.orderStatus.textContent = label;
  elements.orderStatus.classList.toggle("is-active", label === "使用中");
  elements.phoneNumber.textContent = order?.phoneNumber || "+ —";
  elements.lineCaption.textContent = order
    ? `${state.orders.length} 个号码可用 · 当前资料只读`
    : "同步后显示号码资料";
  elements.countryValue.textContent = order
    ? [order.countryCode, order.phoneCode].filter(Boolean).join(" / ") || "—"
    : "—";
  elements.packageValue.textContent = order?.packageId ?? "—";
  elements.expiryValue.textContent = order?.expireTime ? formatTime(order.expireTime) : "—";
  elements.renewValue.textContent = order ? (Number(order.autoRenew) === 1 ? "已开启" : "未开启") : "—";
}

function renderCodeTicket() {
  const record = firstCodeRecord();
  const code = record?.code || "";
  const slotCount = code ? Math.max(4, Math.min(8, Array.from(code).length)) : 6;
  elements.codeSlots.replaceChildren();

  for (let index = 0; index < slotCount; index += 1) {
    const slot = document.createElement("span");
    const character = Array.from(code)[index] || "—";
    slot.className = `code-slot${character === "—" ? " is-empty" : ""}`;
    slot.textContent = character;
    elements.codeSlots.append(slot);
  }

  if (!record) {
    elements.codeNote.textContent = selectedOrder()
      ? "最近短信中没有识别到验证码"
      : "选择号码后读取最近验证码";
  } else {
    const sender = record.message.sender || "未知发送方";
    const time = record.message.time ? formatTime(record.message.time) : "最近短信";
    elements.codeNote.textContent = `${sender} · ${time}`;
  }

  elements.privacyBadge.textContent = state.revealCode ? "完整显示" : "已保护";
  elements.revealLabel.textContent = state.revealCode ? "隐藏验证码" : "显示验证码";
  elements.codeSlots.setAttribute(
    "aria-label",
    !code ? "没有识别到验证码" : state.revealCode ? `验证码 ${code}` : "验证码已保护",
  );
}

function renderMessages() {
  elements.messageList.replaceChildren();
  elements.messageCount.textContent = `${state.messages.length} 条短信`;

  if (state.loadingMessages) {
    elements.messageList.append(createLoadingState());
    return;
  }

  if (!selectedOrder()) {
    elements.messageList.append(createEmptyState("先选择一个号码", "号码同步完成后，这里会显示它的最近短信。"));
    return;
  }

  if (!state.messages.length) {
    elements.messageList.append(createEmptyState("暂时没有短信", "稍后点击“立即刷新”再次检查这个号码。"));
    return;
  }

  for (const message of state.messages.slice(0, 12)) {
    const article = document.createElement("article");
    article.className = "message-item";

    const senderName = String(message.sender || "未知发送方");
    const senderMark = document.createElement("span");
    senderMark.className = "sender-mark";
    senderMark.textContent = Array.from(senderName.trim()).slice(0, 2).join("") || "—";

    const body = document.createElement("div");
    body.className = "message-body";
    const topline = document.createElement("div");
    topline.className = "message-topline";
    const sender = document.createElement("strong");
    sender.className = "message-sender";
    sender.textContent = senderName;
    const time = document.createElement("time");
    time.className = "message-time";
    time.textContent = formatTime(message.time);
    const content = document.createElement("p");
    content.className = "message-content";
    content.textContent = message.content || "无短信正文";
    topline.append(sender, time);
    body.append(topline, content);

    const codes = document.createElement("div");
    codes.className = "message-codes";
    if (Array.isArray(message.code) && message.code.length) {
      for (const value of message.code) {
        const chip = document.createElement("span");
        chip.className = "message-code";
        chip.textContent = `CODE ${value}`;
        codes.append(chip);
      }
    } else {
      const chip = document.createElement("span");
      chip.className = "message-code is-empty";
      chip.textContent = "未识别验证码";
      codes.append(chip);
    }

    article.append(senderMark, body, codes);
    elements.messageList.append(article);
  }
}

function renderControls() {
  const busy = state.loadingOrders || state.loadingMessages;
  const hasOrder = Boolean(selectedOrder());
  const hasMessages = state.messages.length > 0;
  const code = firstCodeRecord()?.code || "";

  document.body.classList.toggle("is-busy", busy);
  elements.overviewGrid.setAttribute("aria-busy", String(busy));
  elements.refreshButton.disabled = !state.authenticated || busy;
  elements.refreshButton.classList.toggle("is-loading", busy);
  elements.numberSelect.disabled = !state.authenticated || busy || !state.orders.length;
  elements.smsToggle.disabled = !state.authenticated || busy || !hasOrder;
  elements.revealButton.disabled = !state.authenticated || busy || !hasOrder || !hasMessages;
  elements.copyButton.disabled = !state.revealCode || !code || busy;
  for (const button of elements.statusTabs.querySelectorAll("[data-status]")) {
    button.disabled = !state.authenticated || busy;
  }
}

function renderAll() {
  renderStatusTabs();
  renderNumberSelect();
  renderLineCard();
  renderCodeTicket();
  renderMessages();
  renderControls();
}

function resetWorkspaceData() {
  state.orders = [];
  state.selectedKey = "";
  state.messages = [];
  state.revealCode = false;
  state.showSms = false;
  state.loadingOrders = false;
  state.loadingMessages = false;
  state.orderRequestSequence += 1;
  state.messageRequestSequence += 1;
  elements.smsToggle.checked = false;
  elements.syncLabel.textContent = "尚未同步";
  setApiState("idle", "等待同步");
  renderAll();
}

function showWorkspace() {
  state.authenticated = true;
  elements.accessView.hidden = true;
  elements.workspace.hidden = false;
  elements.lockButton.hidden = false;
  setConnection("ready", "安全通道已连接");
  renderControls();
}

function showAccess(message = "这里填写控制台口令，不是 Kitesim Token。", isError = false) {
  state.authenticated = false;
  state.accessKey = "";
  storeAccessKey("");
  elements.workspace.hidden = true;
  elements.accessView.hidden = false;
  elements.lockButton.hidden = true;
  elements.accessKey.value = "";
  setConnection("idle", "工作台已锁定");
  setAccessFeedback(message, isError);
  resetWorkspaceData();
  window.setTimeout(() => elements.accessKey.focus(), 0);
}

function explainError(error) {
  if (error.kind === "dashboard_auth") {
    showAccess("访问口令已失效，请重新输入。", true);
    return "访问口令已失效";
  }
  if (error.kind === "upstream_auth") {
    return "Kitesim Token 已失效，请更新服务端环境变量";
  }
  if (error.kind === "configuration") {
    return error.message;
  }
  return error.message || "读取失败，请稍后再试";
}

function setAccessFormBusy(busy) {
  elements.unlockButton.disabled = busy;
  elements.accessKey.disabled = busy;
  elements.passwordVisibility.disabled = busy;
  elements.unlockButton.querySelector("span").textContent = busy ? "正在验证" : "进入工作台";
}

async function verifyAccessKey(key, { quiet = false } = {}) {
  state.accessKey = key;
  setAccessFormBusy(true);
  setConnection("loading", "正在建立安全通道");
  setAccessFeedback("正在验证访问口令…");

  try {
    await apiRequest("/api/session", { method: "POST" });
    storeAccessKey(key);
    showWorkspace();
    await loadOrders({ quiet });
    return true;
  } catch (error) {
    state.accessKey = "";
    storeAccessKey("");
    setConnection("idle", "等待访问口令");
    setAccessFeedback(explainError(error), true);
    return false;
  } finally {
    setAccessFormBusy(false);
  }
}

async function loadOrders({ quiet = false } = {}) {
  if (!state.authenticated || state.loadingOrders) return;
  const sequence = ++state.orderRequestSequence;
  state.loadingOrders = true;
  state.messageRequestSequence += 1;
  state.messages = [];
  state.revealCode = false;
  setConnection("loading", "正在同步号码");
  setApiState("loading", "读取号码");
  elements.syncLabel.textContent = "正在读取号码资料…";
  renderAll();

  let shouldLoadMessages = false;
  let updatedAt = "";
  try {
    const query = new URLSearchParams({ status: state.status, limit: "10" });
    const payload = await apiRequest(`/api/orders?${query.toString()}`);
    if (sequence !== state.orderRequestSequence) return;

    state.orders = Array.isArray(payload.items) ? payload.items : [];
    const previousSelectionExists = state.orders.some((order) => orderKey(order) === state.selectedKey);
    state.selectedKey = previousSelectionExists ? state.selectedKey : orderKey(state.orders[0]);
    updatedAt = payload.updatedAt || "";
    shouldLoadMessages = Boolean(selectedOrder());
    setApiState("ready", state.orders.length ? "号码已读取" : "没有号码");
    elements.syncLabel.textContent = state.orders.length
      ? `${state.orders.length} 个号码 · ${formatTime(updatedAt)}`
      : `当前状态没有号码 · ${formatTime(updatedAt)}`;
  } catch (error) {
    if (sequence !== state.orderRequestSequence) return;
    state.orders = [];
    state.selectedKey = "";
    state.messages = [];
    const message = explainError(error);
    if (!state.authenticated) return;
    setConnection("error", "号码读取失败");
    setApiState("error", "读取失败");
    elements.syncLabel.textContent = message;
    showToast(message, "error");
  } finally {
    if (sequence === state.orderRequestSequence) {
      state.loadingOrders = false;
      renderAll();
    }
  }

  if (sequence !== state.orderRequestSequence) return;
  if (shouldLoadMessages) {
    await loadMessages({ quiet: true });
    if (!quiet && state.authenticated) showToast("号码和短信已刷新", "success");
  } else if (!quiet && state.authenticated && !state.orders.length) {
    setConnection("ready", "接口已连接");
    showToast("接口已连接，当前状态没有号码");
  }
}

async function loadMessages({ quiet = false } = {}) {
  const order = selectedOrder();
  if (!state.authenticated || !order || state.loadingMessages) return;
  const sequence = ++state.messageRequestSequence;
  state.loadingMessages = true;
  setConnection("loading", "正在同步短信");
  setApiState("loading", "读取短信");
  elements.syncLabel.textContent = "正在读取所选号码的短信…";
  renderMessages();
  renderControls();

  try {
    const payload = await apiRequest("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: order.id ?? order.orderNo,
        phoneNumber: order.phoneNumber,
        revealCode: state.revealCode,
        showSms: state.showSms,
      }),
    });
    if (sequence !== state.messageRequestSequence) return;

    state.messages = Array.isArray(payload.items) ? payload.items : [];
    state.revealCode = Boolean(payload.revealCode);
    state.showSms = Boolean(payload.showSms);
    elements.smsToggle.checked = state.showSms;
    setConnection("ready", "安全通道已连接");
    setApiState("ready", "同步完成");
    elements.syncLabel.textContent = `${state.messages.length} 条短信 · ${formatTime(payload.updatedAt)}`;
    if (!quiet) showToast(state.messages.length ? "短信已刷新" : "这个号码暂时没有短信");
  } catch (error) {
    if (sequence !== state.messageRequestSequence) return;
    state.messages = [];
    const message = explainError(error);
    if (!state.authenticated) return;
    setConnection("error", "短信读取失败");
    setApiState("error", "读取失败");
    elements.syncLabel.textContent = message;
    showToast(message, "error");
  } finally {
    if (sequence === state.messageRequestSequence) {
      state.loadingMessages = false;
      renderAll();
    }
  }
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const fallback = document.createElement("textarea");
  fallback.value = value;
  fallback.setAttribute("readonly", "");
  fallback.className = "clipboard-fallback";
  document.body.append(fallback);
  fallback.select();
  const copied = document.execCommand("copy");
  fallback.remove();
  if (!copied) throw new Error("copy failed");
}

async function bootstrap() {
  resetWorkspaceData();
  setConnection("loading", "正在检查服务");
  try {
    const health = await apiRequest("/api/health");
    if (!health.ok) throw new ApiError("服务健康检查失败", 503, "server");
    if (!health.authConfigured) {
      setConnection("error", "缺少服务端配置");
      setAccessFeedback("服务端没有配置 DASHBOARD_ACCESS_KEY，暂时无法解锁。", true);
      elements.accessKey.disabled = true;
      elements.unlockButton.disabled = true;
      return;
    }

    const storedKey = readStoredAccessKey();
    if (storedKey) {
      await verifyAccessKey(storedKey, { quiet: true });
    } else {
      setConnection("idle", "等待访问口令");
      window.setTimeout(() => elements.accessKey.focus(), 0);
    }
  } catch (error) {
    setConnection("error", "服务不可用");
    setAccessFeedback(explainError(error), true);
  }
}

elements.accessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = elements.accessKey.value.trim();
  if (key.length < 12) {
    setAccessFeedback("访问口令至少需要 12 个字符。", true);
    elements.accessKey.focus();
    return;
  }
  await verifyAccessKey(key);
});

elements.passwordVisibility.addEventListener("click", () => {
  const showing = elements.accessKey.type === "text";
  elements.accessKey.type = showing ? "password" : "text";
  elements.passwordVisibility.textContent = showing ? "显示" : "隐藏";
  elements.passwordVisibility.setAttribute("aria-pressed", String(!showing));
  elements.passwordVisibility.setAttribute("aria-label", showing ? "显示访问口令" : "隐藏访问口令");
  elements.accessKey.focus();
});

elements.lockButton.addEventListener("click", () => {
  showAccess("工作台已锁定，访问口令已从当前标签页清除。", false);
});

elements.refreshButton.addEventListener("click", () => loadOrders());

elements.statusTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-status]");
  if (!button || button.disabled || button.dataset.status === state.status) return;
  state.status = button.dataset.status;
  state.selectedKey = "";
  state.messages = [];
  state.revealCode = false;
  renderStatusTabs();
  loadOrders();
});

elements.numberSelect.addEventListener("change", () => {
  state.selectedKey = elements.numberSelect.value;
  state.messages = [];
  state.revealCode = false;
  renderAll();
  loadMessages();
});

elements.smsToggle.addEventListener("change", () => {
  state.showSms = elements.smsToggle.checked;
  loadMessages();
});

elements.revealButton.addEventListener("click", () => {
  state.revealCode = !state.revealCode;
  loadMessages();
});

elements.copyButton.addEventListener("click", async () => {
  const code = firstCodeRecord()?.code || "";
  if (!state.revealCode || !code) return;
  try {
    await copyText(code);
    showToast("验证码已复制", "success");
  } catch {
    showToast("浏览器没有允许访问剪贴板", "error");
  }
});

bootstrap();
