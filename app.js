import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.mjs";
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs";

const els = {
  files: document.getElementById("files"),
  prefix: document.getElementById("prefix"),
  year: document.getElementById("year"),
  start: document.getElementById("start"),
  padding: document.getElementById("padding"),
  dateFormat: document.getElementById("dateFormat"),
  sortOrder: document.getElementById("sortOrder"),
  status: document.getElementById("status"),
  table: document.getElementById("table"),
  emptyState: document.getElementById("emptyState"),
  downloadZip: document.getElementById("downloadZip"),
  dropZone: document.getElementById("dropZone"),
  shopName: document.getElementById("shopName"),
  includeShop: document.getElementById("includeShop"),
  previewName: document.getElementById("previewName"),
  resetCounter: document.getElementById("resetCounter"),
  fileCount: document.getElementById("fileCount"),
  counterSummary: document.getElementById("counterSummary"),
};

const state = {
  items: [],
  busy: false,
};

function setStatus(message) {
  els.status.textContent = message;
}

function padNumber(num, length) {
  if (length <= 0) return String(num);
  return String(num).padStart(length, "0");
}

function sanitizeFragment(value) {
  return String(value)
    .trim()
    .replace(/[\\/?%*:|"<>]/g, "")
    .replace(/\s+/g, "_");
}

function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateFromMatch(match, formatPreference) {
  if (!match) return null;
  if (match.type === "YMD") {
    const [year, month, day] = match.parts.map(Number);
    return new Date(year, month - 1, day);
  }
  if (match.type === "DMY" || match.type === "MDY") {
    const [a, b, year] = match.parts.map(Number);
    if (formatPreference === "MDY") {
      return new Date(year, a - 1, b);
    }
    return new Date(year, b - 1, a);
  }
  if (match.type === "MON") {
    const [monthName, day, year] = match.parts;
    const monthIndex = monthNameToIndex(monthName);
    if (monthIndex === null) return null;
    return new Date(Number(year), monthIndex, Number(day));
  }
  return null;
}

function monthNameToIndex(name) {
  const key = name.toLowerCase().slice(0, 3);
  const map = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
}

function findCandidateDates(text) {
  const candidates = [];
  const patterns = [
    { regex: /(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/g, type: "YMD" },
    { regex: /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/g, type: "DMY" },
    {
      regex:
        /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})/gi,
      type: "MON",
    },
  ];

  patterns.forEach(({ regex, type }) => {
    let match;
    while ((match = regex.exec(text)) !== null) {
      candidates.push({
        index: match.index,
        parts: match.slice(1),
        type,
      });
    }
  });

  return candidates;
}

function chooseBestDate(text, formatPreference) {
  const candidates = findCandidateDates(text);
  if (candidates.length === 0) return null;

  const keywords = [
    "invoice date",
    "rechnungsdatum",
    "invoice",
    "date",
    "datum",
  ];

  const scored = candidates.map((candidate) => {
    const start = Math.max(0, candidate.index - 40);
    const context = text.slice(start, candidate.index).toLowerCase();
    const score = keywords.some((keyword) => context.includes(keyword)) ? 2 : 1;
    return { ...candidate, score };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return parseDateFromMatch(scored[0], formatPreference);
}

function parsePdfMetadataDate(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const pdfMatch = trimmed.match(/D:(\d{4})(\d{2})(\d{2})/);
  if (pdfMatch) {
    const [, year, month, day] = pdfMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const isoMatch = trimmed.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  return null;
}

async function extractPdfText(file) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let combined = "";
  let metadataDate = null;

  try {
    const metadata = await pdf.getMetadata();
    metadataDate =
      parsePdfMetadataDate(metadata?.info?.CreationDate) ||
      parsePdfMetadataDate(metadata?.info?.ModDate) ||
      null;
  } catch (error) {
    metadataDate = null;
  }

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const content = await page.getTextContent();
    const lines = [];
    let line = "";

    content.items.forEach((item) => {
      line += `${item.str} `;
      if (item.hasEOL) {
        lines.push(line.trim());
        line = "";
      }
    });

    if (line.trim()) {
      lines.push(line.trim());
    }

    combined += `${lines.join("\n")}\n`;
  }

  return { text: combined, metadataDate };
}

function computeAssignments() {
  const start = Number(els.start.value) || 1;
  const padding = Math.max(0, Number(els.padding.value) || 0);
  const prefix = els.prefix.value.trim() || "Rechnung";
  const year = els.year.value.trim() || String(new Date().getFullYear());
  const shopName = els.shopName.value.trim();
  const includeShop = els.includeShop.checked && shopName.length > 0;
  const safePrefix = sanitizeFragment(prefix);
  const safeYear = sanitizeFragment(year);
  const safeShop = sanitizeFragment(shopName);
  const namePrefix = includeShop ? `${safeShop}_${safePrefix}` : safePrefix;
  const sortOrder = els.sortOrder.value;

  const today = new Date();
  const itemsWithDate = state.items.filter((item) => item.date);
  const itemsWithoutDate = state.items.filter((item) => !item.date);

  itemsWithDate.sort((a, b) => {
    const diffA = Math.abs(a.date - today);
    const diffB = Math.abs(b.date - today);

    if (sortOrder === "furthest") {
      return diffB - diffA || a.date - b.date;
    }
    if (sortOrder === "newest") {
      return b.date - a.date;
    }
    return a.date - b.date;
  });

  const ordered = [...itemsWithDate, ...itemsWithoutDate];
  ordered.forEach((item, idx) => {
    const number = start + idx;
    item.assignedNumber = number;
    item.newName = `${namePrefix}_${padNumber(number, padding)}_${safeYear}.pdf`;
  });

  const hasMissingDate = itemsWithoutDate.length > 0;
  els.downloadZip.disabled = hasMissingDate || state.items.length === 0;

  if (hasMissingDate) {
    setStatus("Some files are missing a date. Add a date to enable ZIP download.");
  } else if (state.items.length) {
    setStatus("All set. Review the order and download your ZIP.");
  } else {
    setStatus("Upload PDFs to begin.");
  }

  const count = state.items.length;
  const end = count ? start + count - 1 : start;
  els.fileCount.textContent = `${count} file${count === 1 ? "" : "s"} loaded`;
  els.counterSummary.textContent = `Counter: ${start}${count ? `–${end}` : ""} | Shop: ${
    shopName || "-"
  }`;
  els.previewName.textContent = `${namePrefix}_${padNumber(start, padding)}_${safeYear}.pdf`;
}

function renderTable() {
  const rows = state.items.map((item) => {
    const row = document.createElement("div");
    row.className = "row";

    const fileCell = document.createElement("div");
    fileCell.dataset.label = "File";
    fileCell.textContent = item.file.name;

    const dateCell = document.createElement("div");
    dateCell.dataset.label = "Invoice Date";
    const input = document.createElement("input");
    input.type = "date";
    input.className = "date-input";
    input.value = item.date ? formatDateISO(item.date) : "";
    input.addEventListener("change", () => {
      const value = input.value.trim();
      if (!value) {
        item.date = null;
        input.classList.add("invalid");
      } else {
        item.date = new Date(value);
        input.classList.remove("invalid");
      }
      computeAssignments();
      renderTable();
    });
    if (!item.date) {
      input.classList.add("invalid");
    }
    dateCell.appendChild(input);

    const numberCell = document.createElement("div");
    numberCell.dataset.label = "Assigned #";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = item.assignedNumber ? String(item.assignedNumber) : "-";
    numberCell.appendChild(badge);

    const nameCell = document.createElement("div");
    nameCell.dataset.label = "New Filename";
    nameCell.className = "filename";
    nameCell.textContent = item.newName || "-";

    row.appendChild(fileCell);
    row.appendChild(dateCell);
    row.appendChild(numberCell);
    row.appendChild(nameCell);

    return row;
  });

  els.table.querySelectorAll(".row:not(.empty)").forEach((row) => row.remove());
  els.emptyState.style.display = state.items.length ? "none" : "block";
  rows.forEach((row) => els.table.appendChild(row));
}

async function handleFiles(files) {
  if (!files.length) return;
  state.items = [];
  renderTable();
  setStatus("Reading PDFs. This can take a moment...");

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    try {
      const { text, metadataDate } = await extractPdfText(file);
      const date =
        chooseBestDate(text, els.dateFormat.value) || metadataDate || null;
      state.items.push({
        file,
        text,
        date,
        assignedNumber: null,
        newName: null,
      });
    } catch (error) {
      state.items.push({
        file,
        text: "",
        date: null,
        assignedNumber: null,
        newName: null,
      });
    }
    setStatus(`Processed ${i + 1} of ${files.length} files...`);
  }

  computeAssignments();
  renderTable();
}

async function downloadZip() {
  const zip = new JSZip();
  state.items.forEach((item) => {
    zip.file(item.newName, item.file);
  });

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "renamed-invoices.zip";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

els.files.addEventListener("change", (event) => {
  const files = Array.from(event.target.files || []);
  handleFiles(files);
});

[els.prefix, els.year, els.start, els.padding, els.sortOrder, els.shopName].forEach(
  (input) => {
    input.addEventListener("input", () => {
      computeAssignments();
      renderTable();
    });
  },
);

els.includeShop.addEventListener("change", () => {
  computeAssignments();
  renderTable();
});

els.resetCounter.addEventListener("click", () => {
  els.start.value = "1";
  computeAssignments();
  renderTable();
});

els.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.dropZone.classList.add("dragover");
});

els.dropZone.addEventListener("dragleave", () => {
  els.dropZone.classList.remove("dragover");
});

els.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  els.dropZone.classList.remove("dragover");
  const files = Array.from(event.dataTransfer?.files || []);
  handleFiles(files);
});

els.dropZone.addEventListener("click", () => {
  els.files.click();
});

els.dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    els.files.click();
  }
});

els.dateFormat.addEventListener("change", () => {
  if (!state.items.length) return;
  state.items.forEach((item) => {
    if (item.text) {
      item.date = chooseBestDate(item.text, els.dateFormat.value);
    }
  });
  computeAssignments();
  renderTable();
});

els.downloadZip.addEventListener("click", () => {
  if (!els.downloadZip.disabled) {
    downloadZip();
  }
});

computeAssignments();
renderTable();
