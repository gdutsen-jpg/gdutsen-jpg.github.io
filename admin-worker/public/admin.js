"use strict";

const PHOTO_ENTRY_LIMIT = 40;
const PHOTO_ENTRY_FULL_MESSAGE = "这条回忆已达到 40 张照片的上限。";
const PHOTO_EDGE_LIMIT = 2400;
const PHOTO_SIZE_LIMIT = 1024 * 1024;
const SOURCE_SIZE_LIMIT = 25 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const REPOSITORY = "https://github.com/gdutsen-jpg/gdutsen-jpg.github.io";

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
const activityList = document.getElementById("activity-list");
const activityForm = document.getElementById("activity-form");
const activityName = document.getElementById("activity-name");
const activityStatus = document.getElementById("activity-status");
const memoryForm = document.getElementById("memory-form");
const newFields = document.getElementById("new-fields");
const existingFields = document.getElementById("existing-fields");
const memoryChoice = document.getElementById("memory-choice");
const memoryStatus = document.getElementById("memory-status");
const saveMemory = document.getElementById("save-memory");
const photoInput = document.getElementById("photo-files");
const photoStatus = document.getElementById("photo-status");
const photoList = document.getElementById("photo-list");
const pendingOperations = new Map();

let stagedPhoto = null;
let content = null;
let saving = false;
let processingPhotos = false;
let readingContent = false;

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

function syncControls() {
  const locked = saving || processingPhotos || readingContent || !content;
  const existing = memoryForm.elements.mode.value === "existing";
  for (const field of activityForm.elements) {
    field.disabled = locked;
  }
  for (const field of Array.from(memoryForm.elements)) {
    if (field instanceof HTMLFieldSetElement) {
      continue;
    }
    const hiddenField = (existing && newFields.contains(field)) || (!existing && existingFields.contains(field));
    field.disabled = locked || hiddenField;
  }
  const existingOption = memoryForm.querySelector('[value="existing"]');
  existingOption.disabled ||= !content?.memories.length;
  for (const button of photoList.querySelectorAll("button")) {
    button.disabled = locked;
  }
  logout.disabled = saving || processingPhotos;
  retryContent.disabled = saving || processingPhotos || readingContent;
  newFields.hidden = existing;
  existingFields.hidden = !existing;
  memoryChoice.required = existing;
  saveMemory.textContent = existing ? "发布照片" : "发布回忆";
}

function renderContent() {
  const activityRows = content.activities.map((name) => {
    const item = document.createElement("li");
    item.textContent = name;
    return item;
  });
  activityList.replaceChildren(...activityRows);
  activityList.hidden = activityRows.length === 0;

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
}

async function refreshContent() {
  readingContent = true;
  syncControls();
  try {
    const updated = await request("/api/content");
    if (!Array.isArray(updated.activities) || !Array.isArray(updated.memories)) {
      throw new Error("当前活动和回忆无法读取，请重试。");
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

async function save(path, payload, key) {
  const response = await request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, operationId: operationId(key) })
  });
  if (typeof response.changed !== "boolean") {
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

async function addActivity(event) {
  event.preventDefault();
  if (saving || processingPhotos || readingContent || !content) {
    return;
  }
  const name = activityName.value.trim();
  if (!name) {
    setStatus(activityStatus, "请输入活动名称。", { error: true });
    activityName.focus();
    return;
  }
  saving = true;
  syncControls();
  setStatus(activityStatus, "正在提交活动…");
  try {
    const result = await save("/api/activities", { name }, `activity:${name}`);
    activityForm.reset();
    showCommit(
      activityStatus,
      result,
      result.changed ? "已提交到 GitHub。公开相册将在部署后更新。" : "这个活动已在转盘清单中。"
    );
    await refreshContent();
  } catch (error) {
    showRequestError(activityStatus, error);
  } finally {
    saving = false;
    syncControls();
  }
}

function photoEntryFull() {
  const memory = content?.memories.find((entry) => entry.id === memoryChoice.value);
  return memoryForm.elements.mode.value === "existing" && memory?.photoCount >= PHOTO_ENTRY_LIMIT;
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

async function preparePhoto(file) {
  if (!PHOTO_TYPES.has(file.type) && (file.type || !/\.(jpe?g|png|webp|gif|avif)$/i.test(file.name))) {
    throw new Error("请选择 JPG、PNG、WebP、GIF 或 AVIF 照片。");
  }
  if (file.size > SOURCE_SIZE_LIMIT) {
    throw new Error("原始文件请控制在 25 MB 以内。");
  }
  const source = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = source;
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
          const originalName = file.name.replace(/\.[^.]+$/, "").slice(0, 251);
          const name = originalName.replace(/[\uD800-\uDBFF]$/, "") || "照片";
          return { id: crypto.randomUUID(), name: `${name}.jpg`, dataUrl: await dataUrl(blob) };
        }
      }
    }
    throw new Error("压缩后仍超过单张照片大小限制。");
  } finally {
    URL.revokeObjectURL(source);
  }
}

function renderPhoto() {
  photoList.replaceChildren();
  photoList.hidden = !stagedPhoto;
  if (!stagedPhoto) {
    return;
  }
  const item = document.createElement("li");
  const preview = document.createElement("img");
  const name = document.createElement("span");
  const remove = document.createElement("button");
  preview.src = stagedPhoto.dataUrl;
  preview.alt = "";
  name.className = "photo-name";
  name.textContent = stagedPhoto.name;
  name.title = stagedPhoto.name;
  remove.className = "text-button";
  remove.type = "button";
  remove.setAttribute("aria-label", `移除照片 ${stagedPhoto.name}`);
  remove.textContent = "移除";
  remove.addEventListener("click", () => {
    stagedPhoto = null;
    renderPhoto();
    setStatus(photoStatus, "");
    photoInput.focus();
  });
  item.append(preview, name, remove);
  photoList.append(item);
}

async function selectPhoto() {
  const file = photoInput.files[0];
  photoInput.value = "";
  if (!file || saving || processingPhotos) {
    return;
  }
  if (photoEntryFull()) {
    setStatus(photoStatus, PHOTO_ENTRY_FULL_MESSAGE, { error: true });
    return;
  }
  processingPhotos = true;
  syncControls();
  setStatus(memoryStatus, "");
  setStatus(photoStatus, "正在压缩照片…");
  try {
    stagedPhoto = await preparePhoto(file);
    renderPhoto();
    setStatus(photoStatus, "照片已压缩，可以发布。");
  } catch (error) {
    setStatus(photoStatus, `${file.name}：${error.message}`, { error: true });
  } finally {
    processingPhotos = false;
    syncControls();
  }
}

async function publishMemory(event) {
  event.preventDefault();
  if (saving || processingPhotos || readingContent || !content) {
    return;
  }
  if (!stagedPhoto) {
    setStatus(memoryStatus, "请先选择一张照片。", { error: true });
    photoInput.focus();
    return;
  }
  if (photoEntryFull()) {
    setStatus(memoryStatus, PHOTO_ENTRY_FULL_MESSAGE, { error: true });
    return;
  }
  const fields = new FormData(memoryForm);
  const existing = fields.get("mode") === "existing";
  const details = existing ? { entryId: fields.get("entryId") } : {
    date: fields.get("date"),
    title: fields.get("title").trim(),
    category: fields.get("category"),
    story: fields.get("story"),
    location: fields.get("location").trim()
  };
  const { id, name, dataUrl } = stagedPhoto;
  const key = JSON.stringify([details, id]);
  saving = true;
  syncControls();
  setStatus(memoryStatus, "正在上传照片并提交到 GitHub…");
  try {
    const result = await save("/api/memories", { ...details, photos: [{ name, dataUrl }] }, key);
    stagedPhoto = null;
    renderPhoto();
    setStatus(photoStatus, "");
    if (!existing) {
      memoryForm.reset();
    }
    showCommit(
      memoryStatus,
      result,
      result.changed ? "已提交到 GitHub。公开相册将在部署后更新。" : "GitHub 中已有这次提交。"
    );
    await refreshContent();
  } catch (error) {
    showRequestError(memoryStatus, error);
  } finally {
    saving = false;
    syncControls();
  }
}

function updateMemoryDestination() {
  setStatus(memoryStatus, "");
  if (photoEntryFull()) {
    setStatus(photoStatus, PHOTO_ENTRY_FULL_MESSAGE, { error: true });
  } else {
    setStatus(photoStatus, stagedPhoto ? "照片已压缩，可以发布。" : "");
  }
  syncControls();
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
activityForm.addEventListener("submit", addActivity);
memoryForm.addEventListener("submit", publishMemory);
memoryForm.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener("change", updateMemoryDestination);
});
memoryChoice.addEventListener("change", updateMemoryDestination);
photoInput.addEventListener("change", selectPhoto);
syncControls();
showAuthFeedback();
checkSession();
