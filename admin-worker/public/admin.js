"use strict";

const PHOTO_EDGE_LIMIT = 2400;
const PHOTO_SIZE_LIMIT = 1024 * 1024;
const SOURCE_SIZE_LIMIT = 25 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const REPOSITORY = "https://github.com/gdutsen-jpg/gdutsen-jpg.github.io";
const MESSAGE_WALL = "留言墙";
const WHEELS = {
  activities: { label: "活动", example: "周末野餐" },
  cuisines: { label: "菜系", example: "徽菜" }
};

const account = document.getElementById("account");
const albumLink = document.getElementById("album-link");
const access = document.getElementById("access");
const accessStatus = document.getElementById("access-status");
const login = document.getElementById("login");
const retrySession = document.getElementById("retry-session");
const logout = document.getElementById("logout");
const sessionError = document.getElementById("session-error");
const contentError = document.getElementById("content-error");
const contentErrorText = document.getElementById("content-error-text");
const retryContent = document.getElementById("retry-content");
const editor = document.getElementById("editor");
const editorIntro = document.getElementById("editor-intro");
const wheelPicker = document.getElementById("wheel-picker");
const wheelOptions = document.getElementById("wheel-options");
const wheelOptionsEmpty = document.getElementById("wheel-options-empty");
const wheelOptionForm = document.getElementById("wheel-option-form");
const wheelOptionLabel = document.getElementById("wheel-option-label");
const wheelOptionName = document.getElementById("wheel-option-name");
const addWheelOptionButton = document.getElementById("add-wheel-option");
const wheelOptionStatus = document.getElementById("wheel-option-status");
const wheelRemoveDialog = document.getElementById("wheel-remove-dialog");
const wheelRemoveTitle = document.getElementById("wheel-remove-title");
const wheelRemoveDetail = document.getElementById("wheel-remove-detail");
const memoryForm = document.getElementById("memory-form");
const memoryCategory = memoryForm.elements.category;
const memoryStory = memoryForm.elements.story;
const memoryStoryNote = document.getElementById("memory-story-note");
const newFields = document.getElementById("new-fields");
const existingFields = document.getElementById("existing-fields");
const memoryChoice = document.getElementById("memory-choice");
const memoryStatus = document.getElementById("memory-status");
const saveMemory = document.getElementById("save-memory");
const photoInput = document.getElementById("photo-files");
const photoHelp = document.getElementById("photo-help");
const photoStatus = document.getElementById("photo-status");
const photoList = document.getElementById("photo-list");
const queueCoverPicker = document.getElementById("queue-cover-picker");
const existingCover = document.getElementById("existing-cover");
const toggleExistingCover = document.getElementById("toggle-existing-cover");
const existingCoverForm = document.getElementById("existing-cover-form");
const existingCoverList = document.getElementById("existing-cover-list");
const existingCoverStatus = document.getElementById("existing-cover-status");
const saveExistingCover = existingCoverForm.querySelector('button[type="submit"]');
const visitedSection = document.getElementById("visited-section");
const saveVisited = document.getElementById("save-visited");
const visitedDraft = document.getElementById("visited-draft");
const visitedStatus = document.getElementById("visited-status");
const pendingOperations = new Map();
const stagedPhotos = [];
const wheelDrafts = new Map();

let queuedCoverId = "";
let pendingPublication = null;
let coverPickerEntryId = "";
let coverPickerOpen = false;
let selectedExistingCoverId = "";
let pendingVisitSave = null;
let selectedWheel = wheelPicker.querySelector("input:checked").value;
let wheelRemoval = null;
let content = null;
let saving = false;
let readingContent = false;
const visitMapEditor = globalThis.createGomokuMapEditor?.(visitedSection, () => {
  setStatus(visitedStatus, "");
  syncControls();
});

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, options) {
  let response;
  try {
    response = await fetch(path, { cache: "no-store", ...options });
  } catch {
    throw new Error("无法连接管理服务，请重试。");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      typeof data?.error === "string" ? data.error : "请求失败，请稍后重试。",
      response.status
    );
  }
  if (!data || typeof data !== "object") {
    throw new Error("管理服务返回的内容无法读取，请重试。");
  }
  return data;
}

function setStatus(element, message, { error = false, link } = {}) {
  element.textContent = message;
  element.classList.toggle("error", error);
  element.hidden = !message;
  if (link) {
    const anchor = document.createElement("a");
    anchor.href = link.href;
    anchor.textContent = link.label;
    if (anchor.origin !== location.origin) {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    }
    element.append(" ", anchor);
  }
}

function showRequestError(element, error) {
  if (error.status === 401) {
    setStatus(element, "会话已过期，请重新登录后再提交。", {
      error: true,
      link: { href: "/auth/login", label: "使用 GitHub 登录" }
    });
    return;
  }
  setStatus(element, error.message, { error: true });
}

function editorLocked() {
  return saving || readingContent || !content;
}

function selectedMemory() {
  return content?.memories.find((memory) => memory.id === memoryChoice.value);
}

function syncControls() {
  const locked = editorLocked();
  const existing = memoryForm.elements.mode.value === "existing";
  const messageWall = !existing && memoryCategory.value === MESSAGE_WALL;
  wheelPicker.disabled = locked;
  const wheelLocked = locked || !Array.isArray(content?.[selectedWheel]);
  for (const field of wheelOptionForm.elements) {
    field.disabled = wheelLocked;
  }
  for (const button of wheelOptions.querySelectorAll("button")) {
    button.disabled = wheelLocked;
  }
  for (const field of Array.from(memoryForm.elements)) {
    if (field instanceof HTMLFieldSetElement) {
      continue;
    }
    const hiddenField = (existing && newFields.contains(field)) || (!existing && existingFields.contains(field));
    field.disabled = locked || hiddenField || (pendingPublication !== null && field !== saveMemory);
  }
  const existingOption = memoryForm.querySelector('[value="existing"]');
  existingOption.disabled ||= !content?.memories.length;
  const editingCoverLocked = locked || pendingPublication !== null;
  for (const input of existingCoverList.querySelectorAll("input")) {
    input.disabled = editingCoverLocked;
  }
  toggleExistingCover.disabled = editingCoverLocked;
  saveExistingCover.disabled = editingCoverLocked || !selectedExistingCoverId || selectedExistingCoverId === selectedMemory()?.coverPhotoId;
  logout.disabled = saving;
  retryContent.disabled = saving || readingContent;
  newFields.hidden = existing;
  existingFields.hidden = !existing;
  memoryChoice.required = existing;
  memoryStoryNote.textContent = messageWall ? "无照片时必填" : "选填";
  photoHelp.textContent = messageWall ? "照片选填，可一次选择多张。" : "可一次选择多张照片，网页会自动压缩。";
  const action = existing ? "发布照片" : messageWall ? "发布留言" : "发布回忆";
  saveMemory.textContent = pendingPublication ? "重试发布" : action;
  const mapsLocked = visitMapEditor?.setLocked(locked || Boolean(pendingVisitSave));
  const visitCount = (pendingVisitSave?.changes ?? visitMapEditor?.changes())?.length ?? 0;
  saveVisited.disabled = locked || !visitCount || (!pendingVisitSave && mapsLocked);
  saveVisited.textContent = pendingVisitSave && !saving ? "重试保存" : "保存足迹";
  visitedDraft.hidden = visitCount === 0;
  visitedDraft.textContent = visitCount ? `${visitCount} 处更改待保存` : "";
}

function renderWheelOptions() {
  const wheel = selectedWheel;
  const { label: wheelLabel, example } = WHEELS[wheel];
  const options = content?.[wheel];
  const available = Array.isArray(options);
  const rows = (available ? options : []).map((name, index) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    const remove = document.createElement("button");
    label.textContent = name;
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "删除";
    remove.setAttribute("aria-label", `删除${wheelLabel} ${name}`);
    remove.addEventListener("click", () => {
      if (editorLocked() || selectedWheel !== wheel) {
        return;
      }
      wheelRemoval = { wheel, name, index, trigger: remove };
      wheelRemoveTitle.textContent = `删除${wheelLabel}`;
      wheelRemoveDetail.textContent = `确定从${wheelLabel}转盘中删除“${name}”吗？`;
      wheelRemoveDialog.returnValue = "";
      wheelRemoveDialog.showModal();
    });
    item.append(label, remove);
    return item;
  });
  wheelOptions.replaceChildren(...rows);
  wheelOptions.setAttribute("aria-label", `${wheelLabel}转盘选项`);
  wheelOptions.hidden = rows.length === 0;
  wheelOptionsEmpty.hidden = rows.length > 0;
  wheelOptionsEmpty.textContent = available ? `转盘暂无${wheelLabel}。` : `暂时无法读取${wheelLabel}转盘。`;
  wheelOptionLabel.textContent = `${wheelLabel}名称`;
  wheelOptionName.placeholder = `例如，${example}`;
  addWheelOptionButton.textContent = `添加${wheelLabel}`;
}

function selectWheel(event) {
  const wheel = event.target.value;
  if (!Object.hasOwn(WHEELS, wheel) || wheel === selectedWheel || editorLocked()) {
    return;
  }
  wheelDrafts.set(selectedWheel, wheelOptionName.value);
  selectedWheel = wheel;
  wheelOptionName.value = wheelDrafts.get(wheel) ?? "";
  setStatus(wheelOptionStatus, "");
  renderWheelOptions();
  syncControls();
}

function renderContent() {
  renderWheelOptions();
  const selectedMemory = memoryChoice.value;
  const memoryOptions = content.memories.map((memory) => {
    const title = memory.title || "未命名回忆";
    const count = Number.isInteger(memory.photoCount) ? ` · ${memory.photoCount} 张` : "";
    const label = [memory.date, title].filter(Boolean).join(" · ");
    return new Option(label + count, memory.id);
  });
  memoryChoice.replaceChildren(new Option("选择一条回忆", ""), ...memoryOptions);
  memoryChoice.value = content.memories.some((memory) => memory.id === selectedMemory) ? selectedMemory : "";
  if (!memoryOptions.length) {
    memoryForm.elements.mode.value = "new";
  }
  renderExistingCover();
  visitMapEditor?.receive(content.visited);
}

async function refreshContent() {
  readingContent = true;
  syncControls();
  try {
    const updated = await request("/api/content");
    if (!Array.isArray(updated.activities) || !Array.isArray(updated.memories)) {
      throw new Error("暂时无法读取转盘和回忆，请重试。");
    }
    content = updated;
    renderContent();
    contentError.hidden = true;
  } catch (error) {
    contentError.hidden = false;
    showRequestError(contentErrorText, error);
  } finally {
    readingContent = false;
    syncControls();
  }
}

function showAuthFeedback() {
  const page = new URL(location.href);
  const result = page.searchParams.get("error");
  if (result === "auth") {
    setStatus(sessionError, "GitHub 登录未完成，请重新登录。", { error: true });
  } else if (result === "expired") {
    setStatus(sessionError, "GitHub 登录链接已过期，请重新点击登录。", { error: true });
  } else if (result === "forbidden") {
    setStatus(sessionError, "此账号没有管理权限，请切换到 gdutsen-jpg 后重新登录。", { error: true });
  } else {
    return;
  }
  page.searchParams.delete("error");
  history.replaceState(null, "", page);
}

async function checkSession() {
  accessStatus.textContent = "正在检查登录状态…";
  retrySession.hidden = true;
  login.hidden = true;
  try {
    const session = await request("/api/session");
    if (typeof session.albumUrl === "string" && /^https?:\/\//i.test(session.albumUrl)) {
      albumLink.href = session.albumUrl;
    }
    if (session.ready === false) {
      accessStatus.textContent = "管理服务尚未配置。";
      return;
    }
    if (!session.user?.login) {
      accessStatus.textContent = "请使用 gdutsen-jpg 账号登录以管理相册。";
      login.hidden = false;
      return;
    }
    access.hidden = true;
    editorIntro.hidden = false;
    editor.hidden = false;
    account.hidden = false;
    document.getElementById("account-name").textContent = session.user.login;
    setStatus(sessionError, "");
    await refreshContent();
  } catch (error) {
    accessStatus.textContent = error.message;
    retrySession.hidden = false;
  }
}

function operationId(key) {
  if (pendingOperations.has(key)) {
    return pendingOperations.get(key);
  }
  if (pendingOperations.size >= 12) {
    pendingOperations.delete(pendingOperations.keys().next().value);
  }
  const id = crypto.randomUUID();
  pendingOperations.set(key, id);
  return id;
}

function post(path, payload) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function save(path, payload, key, requireEntryId = false) {
  const response = await post(path, { ...payload, operationId: payload.operationId ?? operationId(key) });
  if (typeof response.changed !== "boolean" || (requireEntryId && (typeof response.entryId !== "string" || !response.entryId))) {
    throw new Error("暂时无法确认提交结果，请重试同一条内容。");
  }
  pendingOperations.delete(key);
  return response;
}

function showCommit(element, result, message) {
  const link = /^[a-f0-9]{40}$/i.test(result.commit)
    ? { href: `${REPOSITORY}/commit/${result.commit}`, label: "查看 GitHub 提交" }
    : undefined;
  setStatus(element, message, { link });
}

function addWheelOption(event) {
  event.preventDefault();
  const wheel = selectedWheel;
  if (editorLocked() || !Array.isArray(content?.[wheel])) {
    return;
  }
  const name = wheelOptionName.value.trim();
  if (!name) {
    setStatus(wheelOptionStatus, `请输入${WHEELS[wheel].label}名称。`, { error: true });
    wheelOptionName.focus();
    return;
  }
  return updateWheelOption(wheel, "add", name);
}

async function updateWheelOption(wheel, action, name) {
  const { label } = WHEELS[wheel];
  const remove = action === "remove";
  saving = true;
  syncControls();
  setStatus(wheelOptionStatus, remove ? `正在删除${label}…` : `正在提交${label}…`);
  try {
    const result = await save("/api/wheel-options", { wheel, action, name }, `wheel:${wheel}:${action}:${name}`);
    if (!remove) {
      wheelOptionName.value = "";
      wheelDrafts.delete(wheel);
    }
    const status = remove
      ? (result.changed ? "已提交删除。公开相册将在部署后更新。" : `这项${label}已从转盘中移除。`)
      : (result.changed ? "已提交到 GitHub。公开相册将在部署后更新。" : `这项${label}已在转盘清单中。`);
    showCommit(wheelOptionStatus, result, status);
    await refreshContent();
  } catch (error) {
    showRequestError(wheelOptionStatus, error);
  } finally {
    saving = false;
    syncControls();
  }
}

async function confirmWheelRemoval() {
  const removal = wheelRemoval;
  wheelRemoval = null;
  if (!removal || wheelRemoveDialog.returnValue !== "remove" || editorLocked() || removal.wheel !== selectedWheel) {
    return;
  }
  await updateWheelOption(removal.wheel, "remove", removal.name);
  if (document.activeElement === document.body || document.activeElement === removal.trigger) {
    const buttons = wheelOptions.querySelectorAll("button");
    const next = buttons[removal.index] ?? buttons[removal.index - 1] ?? wheelOptionName;
    next.focus();
  }
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("照片压缩失败。"));
      }
    }, "image/jpeg", quality);
  });
}

function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result), { once: true });
    reader.addEventListener("error", () => reject(new Error("照片读取失败。")), { once: true });
    reader.readAsDataURL(blob);
  });
}

async function preparePhoto(photo) {
  const image = new Image();
  image.src = photo.url;
  await image.decode().catch(() => {
    throw new Error("这张照片无法打开。");
  });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context || !image.naturalWidth || !image.naturalHeight) {
    throw new Error("这张照片无法压缩。");
  }
  const scale = Math.min(1, PHOTO_EDGE_LIMIT / Math.max(image.naturalWidth, image.naturalHeight));
  for (const size of [scale, scale * 0.8, scale * 0.64]) {
    canvas.width = Math.max(1, Math.round(image.naturalWidth * size));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * size));
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.8, 0.7]) {
      const blob = await canvasBlob(canvas, quality);
      if (blob.size <= PHOTO_SIZE_LIMIT) {
        return dataUrl(blob);
      }
    }
  }
  throw new Error("压缩后仍超过单张照片大小限制。");
}

function photoCard(photo, group, coverId) {
  const item = document.createElement("li");
  const label = document.createElement("label");
  const preview = document.createElement("img");
  const name = document.createElement("span");
  const option = document.createElement("span");
  const radio = document.createElement("input");
  label.className = "photo-choice";
  preview.src = photo.url;
  preview.alt = "";
  preview.loading = "lazy";
  preview.decoding = "async";
  name.className = "photo-name";
  name.textContent = photo.name;
  name.title = photo.name;
  option.className = "cover-option";
  radio.type = "radio";
  radio.name = group;
  radio.value = photo.id;
  radio.checked = photo.id === coverId;
  radio.setAttribute("aria-label", `将 ${photo.name} 设为封面`);
  option.append(radio, "设为封面");
  label.append(preview, name, option);
  item.append(label);
  return { item, radio };
}

function renderQueuedPhotos() {
  const rows = stagedPhotos.map((photo, index) => {
    const { item, radio } = photoCard(photo, "upload-cover", queuedCoverId);
    const remove = document.createElement("button");
    radio.addEventListener("change", () => {
      queuedCoverId = photo.id;
    });
    remove.className = "text-button";
    remove.type = "button";
    remove.setAttribute("aria-label", `移除照片 ${photo.name}`);
    remove.textContent = "移除";
    remove.addEventListener("click", () => {
      URL.revokeObjectURL(photo.url);
      stagedPhotos.splice(index, 1);
      if (queuedCoverId === photo.id) {
        queuedCoverId = "";
      }
      renderQueuedPhotos();
      setStatus(photoStatus, "");
      setStatus(memoryStatus, "");
      (photoList.querySelectorAll("button")[index] ?? photoInput).focus();
    });
    item.append(remove);
    if (photo.error) {
      const error = document.createElement("p");
      error.className = "photo-error";
      error.textContent = photo.error;
      item.append(error);
    }
    return item;
  });
  photoList.replaceChildren(...rows);
  queueCoverPicker.hidden = rows.length === 0;
  queueCoverPicker.querySelector('input[value=""]').checked = !queuedCoverId;
}

function selectPhotos() {
  const files = Array.from(photoInput.files);
  photoInput.value = "";
  if (!files.length || editorLocked() || pendingPublication) {
    return;
  }
  const rejected = [];
  for (const file of files) {
    if (!PHOTO_TYPES.has(file.type) && (file.type || !/\.(jpe?g|png|webp|gif|avif)$/i.test(file.name))) {
      rejected.push(`${file.name}（格式不支持）`);
    } else if (file.size > SOURCE_SIZE_LIMIT) {
      rejected.push(`${file.name}（超过 25 MB）`);
    } else {
      const stem = file.name.replace(/\.[^.]+$/, "").slice(0, 251).replace(/[\uD800-\uDBFF]$/, "");
      stagedPhotos.push({ id: crypto.randomUUID(), url: URL.createObjectURL(file), name: `${stem || "照片"}.jpg` });
    }
  }
  renderQueuedPhotos();
  setStatus(memoryStatus, "");
  const selected = stagedPhotos.length ? `已选 ${stagedPhotos.length} 张照片。` : "";
  const errors = rejected.length ? ` 这 ${rejected.length} 个文件无法添加：${rejected.slice(0, 3).join("、")}${rejected.length > 3 ? "等" : ""}。` : "";
  setStatus(photoStatus, (selected + errors).trim(), { error: rejected.length > 0 });
}

async function stagePhotos() {
  let prepared = stagedPhotos.filter((photo) => photo.receipt).length;
  for (const photo of stagedPhotos) {
    if (photo.receipt || photo.error) {
      continue;
    }
    setStatus(memoryStatus, `已准备 ${prepared}/${stagedPhotos.length} 张，正在处理 ${photo.name}…`);
    try {
      photo.dataUrl ??= await preparePhoto(photo);
    } catch (error) {
      photo.error = error.message;
      continue;
    }
    const staged = await post("/api/photos", { operationId: photo.id, name: photo.name, dataUrl: photo.dataUrl });
    if (typeof staged.id !== "string" || typeof staged.receipt !== "string" || !staged.id || !staged.receipt) {
      throw new Error("暂时无法确认照片是否已准备，请重试。");
    }
    photo.stagedId = staged.id;
    photo.receipt = staged.receipt;
    delete photo.dataUrl;
    prepared += 1;
  }
  return prepared;
}

async function publishMemory(event) {
  event.preventDefault();
  if (editorLocked()) {
    return;
  }
  const fields = new FormData(memoryForm);
  const details = pendingPublication ?? (fields.get("mode") === "existing"
    ? { entryId: fields.get("entryId") }
    : {
      date: fields.get("date"),
      title: fields.get("title").trim(),
      category: fields.get("category"),
      story: fields.get("story"),
      location: fields.get("location").trim()
    });
  if (!stagedPhotos.length) {
    if (details.category !== MESSAGE_WALL) {
      setStatus(memoryStatus, "请先选择一张照片。", { error: true });
      photoInput.focus();
      return;
    }
    if (!details.story.trim()) {
      setStatus(memoryStatus, "只发布文字时，请先填写想记下的话。", { error: true });
      memoryStory.focus();
      return;
    }
  }
  saving = true;
  syncControls();
  let sendingPublication = false;
  try {
    if (!pendingPublication?.photoReceipts) {
      const prepared = await stagePhotos();
      if (prepared !== stagedPhotos.length) {
        setStatus(memoryStatus, `已准备 ${prepared} 张照片。请移除无法处理的照片后再发布。`, { error: true });
        return;
      }
      pendingPublication = {
        ...details,
        operationId: pendingPublication?.operationId ?? crypto.randomUUID(),
        photoReceipts: stagedPhotos.map((photo) => photo.receipt)
      };
      const cover = stagedPhotos.find((photo) => photo.id === queuedCoverId);
      if (cover) {
        pendingPublication.coverPhotoId = cover.stagedId;
      }
    }
    const submitting = stagedPhotos.length
      ? `正在将 ${stagedPhotos.length} 张照片提交到 GitHub…`
      : "正在将留言提交到 GitHub…";
    setStatus(memoryStatus, submitting);
    sendingPublication = true;
    const result = await save("/api/memories", pendingPublication, null, true);
    if (!pendingPublication.entryId) {
      memoryForm.reset();
    }
    pendingPublication = null;
    for (const photo of stagedPhotos.splice(0)) {
      URL.revokeObjectURL(photo.url);
    }
    queuedCoverId = "";
    setStatus(photoStatus, "");
    showCommit(
      memoryStatus,
      result,
      result.changed ? "已提交到 GitHub。公开相册将在部署后更新。" : "GitHub 中已有这次提交。"
    );
    await refreshContent();
  } catch (error) {
    if (sendingPublication && error.status === 422 && error.message.includes("暂存已过期")) {
      for (const photo of stagedPhotos) {
        delete photo.receipt;
        delete photo.stagedId;
      }
      pendingPublication.photoReceipts = null;
      setStatus(memoryStatus, "上传凭证已过期。再次发布即可重新准备已选照片。", { error: true });
      return;
    }
    if (sendingPublication && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
      pendingPublication = null;
    }
    showRequestError(memoryStatus, error);
  } finally {
    saving = false;
    renderQueuedPhotos();
    syncControls();
  }
}

function renderExistingCover() {
  const memory = memoryForm.elements.mode.value === "existing" ? selectedMemory() : null;
  const entryId = memory?.id ?? "";
  const photos = memory?.photos ?? [];
  if (coverPickerEntryId !== entryId) {
    coverPickerEntryId = entryId;
    coverPickerOpen = false;
    selectedExistingCoverId = "";
    setStatus(existingCoverStatus, "");
  }
  existingCover.hidden = photos.length === 0;
  toggleExistingCover.textContent = coverPickerOpen ? "收起封面选择" : "更换已有封面";
  toggleExistingCover.setAttribute("aria-expanded", String(coverPickerOpen));
  existingCoverForm.hidden = !coverPickerOpen;
  if (!coverPickerOpen) {
    existingCoverList.replaceChildren();
    return;
  }
  if (!photos.some((photo) => photo.id === selectedExistingCoverId)) {
    selectedExistingCoverId = memory.coverPhotoId || photos[0]?.id || "";
  }
  const rows = photos.map((photo) => {
    const { item, radio } = photoCard(photo, "existing-photo-cover", selectedExistingCoverId);
    radio.addEventListener("change", () => {
      selectedExistingCoverId = photo.id;
      syncControls();
    });
    return item;
  });
  existingCoverList.replaceChildren(...rows);
}

function changeExistingCoverVisibility() {
  coverPickerOpen = !coverPickerOpen;
  renderExistingCover();
  syncControls();
}

async function updateExistingCover(event) {
  event.preventDefault();
  const memory = selectedMemory();
  if (editorLocked() || pendingPublication || !memory || !selectedExistingCoverId || selectedExistingCoverId === memory.coverPhotoId) {
    return;
  }
  const entryId = memory.id;
  const photoId = selectedExistingCoverId;
  saving = true;
  syncControls();
  setStatus(existingCoverStatus, "正在提交封面…");
  try {
    const result = await save("/api/memories/cover", { entryId, photoId }, `cover:${entryId}:${photoId}`);
    memory.coverPhotoId = photoId;
    showCommit(
      existingCoverStatus,
      result,
      result.changed ? "已提交封面。公开相册将在部署后更新。" : "这张照片已是回忆封面。"
    );
    await refreshContent();
  } catch (error) {
    showRequestError(existingCoverStatus, error);
  } finally {
    saving = false;
    syncControls();
  }
}

function updateMemoryDestination() {
  setStatus(memoryStatus, "");
  renderExistingCover();
  syncControls();
}

async function publishVisited() {
  if (editorLocked()) {
    return;
  }
  const changes = pendingVisitSave?.changes ?? visitMapEditor?.changes();
  if (!changes?.length) {
    return;
  }
  pendingVisitSave ??= { changes, operationId: crypto.randomUUID() };
  saving = true;
  syncControls();
  setStatus(visitedStatus, "正在提交足迹…");
  try {
    const result = await save("/api/visited", pendingVisitSave, null);
    visitMapEditor.markSaved(changes);
    pendingVisitSave = null;
    showCommit(
      visitedStatus,
      result,
      result.changed ? "已提交足迹。公开相册将在部署后更新。" : "这些足迹已保存。"
    );
    await refreshContent();
  } catch (error) {
    if (error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
      pendingVisitSave = null;
    }
    showRequestError(visitedStatus, error);
  } finally {
    saving = false;
    syncControls();
  }
}

logout.addEventListener("click", async () => {
  logout.disabled = true;
  try {
    const response = await fetch("/auth/logout", { method: "POST", cache: "no-store" });
    if (!response.ok) {
      throw new Error("退出登录失败，请稍后重试。");
    }
    location.reload();
  } catch {
    logout.disabled = false;
    setStatus(sessionError, "退出登录失败，请稍后重试。", { error: true });
  }
});
retrySession.addEventListener("click", checkSession);
retryContent.addEventListener("click", refreshContent);
wheelPicker.addEventListener("change", selectWheel);
wheelOptionForm.addEventListener("submit", addWheelOption);
wheelRemoveDialog.addEventListener("close", confirmWheelRemoval);
memoryForm.addEventListener("submit", publishMemory);
memoryForm.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener("change", updateMemoryDestination);
});
memoryChoice.addEventListener("change", updateMemoryDestination);
memoryCategory.addEventListener("change", updateMemoryDestination);
photoInput.addEventListener("change", selectPhotos);
queueCoverPicker.querySelector('input[value=""]').addEventListener("change", () => {
  queuedCoverId = "";
});
toggleExistingCover.addEventListener("click", changeExistingCoverVisibility);
existingCoverForm.addEventListener("submit", updateExistingCover);
saveVisited.addEventListener("click", publishVisited);
syncControls();
showAuthFeedback();
checkSession();
