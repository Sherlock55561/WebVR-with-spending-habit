(function () {
  "use strict";

  function asText(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return value.toFixed(4);
    return String(value);
  }

  function escapeHtml(text) {
    var map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    };
    return String(text).replace(/[&<>\"']/g, function (m) { return map[m]; });
  }

  function byId(id) {
    if (typeof document === "undefined") return null;
    return document.getElementById(id);
  }

  function renderTable(title, rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return "";
    }
    var cols = Object.keys(rows[0]);
    var head = cols.map(function (c) { return "<th>" + c + "</th>"; }).join("");
    var body = rows.map(function (row) {
      return "<tr>" + cols.map(function (c) { return "<td>" + asText(row[c]) + "</td>"; }).join("") + "</tr>";
    }).join("");
    return (
      "<section class='panel'>" +
      "<h3>" + title + "</h3>" +
      "<table><thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table>" +
      "</section>"
    );
  }

  function collectTaskAnswers(tasks, formEl) {
    var answers = {};
    tasks.forEach(function (task) {
      if (task.type === "multi_choice") {
        var checked = formEl.querySelectorAll("input[name='" + task.id + "']:checked");
        answers[task.id] = Array.prototype.map.call(checked, function (input) { return input.value; });
      } else {
        var selected = formEl.querySelector("input[name='" + task.id + "']:checked");
        answers[task.id] = selected ? selected.value : "";
      }
    });
    return answers;
  }

  function collectCheckedValues(formEl, name) {
    var checked = formEl.querySelectorAll("input[name='" + name + "']:checked");
    return Array.prototype.map.call(checked, function (input) { return input.value; });
  }

  function downloadJson(filename, data) {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function parseCsvText(csvText) {
    var lines = String(csvText || "").replace(/\r/g, "").split("\n").filter(function (line) {
      return line.trim().length > 0;
    });
    if (lines.length === 0) return [];
    var headers = lines[0].split(",").map(function (h) { return h.trim(); });
    var rows = [];
    for (var i = 1; i < lines.length; i += 1) {
      var parts = lines[i].split(",");
      if (parts.length < headers.length) continue;
      var row = {};
      for (var j = 0; j < headers.length; j += 1) {
        var raw = (parts[j] || "").trim();
        if (raw === "") {
          row[headers[j]] = "";
          continue;
        }
        var n = Number(raw);
        row[headers[j]] = Number.isFinite(n) ? n : raw;
      }
      rows.push(row);
    }
    return rows;
  }

  async function loadCsvRows(url) {
    var response = await fetch(url);
    if (!response.ok) {
      throw new Error("CSV fetch failed: " + response.status);
    }
    var text = await response.text();
    return parseCsvText(text);
  }

  function computePressureRange(rows) {
    var min = Infinity;
    var max = -Infinity;
    (rows || []).forEach(function (row) {
      var v = Number(row.Pressure_Index_clip);
      if (!Number.isFinite(v)) return;
      if (v < min) min = v;
      if (v > max) max = v;
    });
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: 0, max: 1 };
    }
    if (min === max) {
      return { min: min, max: min + 1e-9 };
    }
    return { min: min, max: max };
  }

  function clamp01(v) {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  function lerp(a, b, t) {
    return a + ((b - a) * t);
  }

  function pressureToColor(value, range) {
    var t = clamp01((value - range.min) / (range.max - range.min || 1));
    // Light cyan -> dark red for high contrast.
    var c1 = { r: 224, g: 247, b: 250 };
    var c2 = { r: 153, g: 27, b: 27 };
    var r = Math.round(lerp(c1.r, c2.r, t));
    var g = Math.round(lerp(c1.g, c2.g, t));
    var b = Math.round(lerp(c1.b, c2.b, t));
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function computeQuantile(sortedValues, q) {
    if (!Array.isArray(sortedValues) || sortedValues.length === 0) return 0;
    var clampedQ = clamp01(Number(q));
    var n = sortedValues.length;
    if (n === 1) return Number(sortedValues[0]) || 0;
    var index = (n - 1) * clampedQ;
    var lower = Math.floor(index);
    var upper = Math.ceil(index);
    if (lower === upper) return Number(sortedValues[lower]) || 0;
    var weight = index - lower;
    var lowVal = Number(sortedValues[lower]) || 0;
    var highVal = Number(sortedValues[upper]) || 0;
    return lowVal + ((highVal - lowVal) * weight);
  }

  function getQuantileBounds(rows, field, lowQ, highQ) {
    var values = [];
    (rows || []).forEach(function (row) {
      var v = Number(row[field]);
      if (Number.isFinite(v)) values.push(v);
    });
    if (!values.length) return { min: 0, max: 1 };
    values.sort(function (a, b) { return a - b; });
    var low = Number.isFinite(Number(lowQ)) ? Number(lowQ) : 0.1;
    var high = Number.isFinite(Number(highQ)) ? Number(highQ) : 0.9;
    if (high < low) {
      var tmp = high;
      high = low;
      low = tmp;
    }
    var min = computeQuantile(values, low);
    var max = computeQuantile(values, high);
    if (min === max) max = min + 1e-9;
    return { min: min, max: max };
  }

  function normalizeWithBounds(value, bounds) {
    var v = Number(value);
    if (!Number.isFinite(v)) return 0;
    var min = bounds && Number.isFinite(Number(bounds.min)) ? Number(bounds.min) : 0;
    var max = bounds && Number.isFinite(Number(bounds.max)) ? Number(bounds.max) : 1;
    if (max <= min) return 0;
    return clamp01((v - min) / (max - min));
  }

  function hexToRgb(hex) {
    var s = String(hex || "").trim().replace(/^#/, "");
    if (s.length === 3) {
      s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    }
    if (!/^[0-9a-fA-F]{6}$/.test(s)) {
      return { r: 0, g: 0, b: 0 };
    }
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16)
    };
  }

  function rgbToHex(rgb) {
    function toHex(v) {
      var n = Math.max(0, Math.min(255, Math.round(v)));
      var h = n.toString(16);
      return h.length === 1 ? "0" + h : h;
    }
    return "#" + toHex(rgb.r) + toHex(rgb.g) + toHex(rgb.b);
  }

  function mixHexColors(hexA, hexB, t) {
    var a = hexToRgb(hexA);
    var b = hexToRgb(hexB);
    var u = clamp01(Number(t));
    return rgbToHex({
      r: lerp(a.r, b.r, u),
      g: lerp(a.g, b.g, u),
      b: lerp(a.b, b.b, u)
    });
  }

  function computeCombinedColor(incomeNorm, pressureNorm) {
    var incomeColor = mixHexColors("#330000", "#ff0000", incomeNorm);
    return mixHexColors(incomeColor, "#ffd400", pressureNorm);
  }

  function matchesStudyFilters(row, filters) {
    if (!row) return false;
    var occupations = (filters && Array.isArray(filters.occupations)) ? filters.occupations : [];
    var cityTiers = (filters && Array.isArray(filters.cityTiers)) ? filters.cityTiers : [];
    var occOk = occupations.length === 0 || occupations.indexOf(String(row.Occupation)) >= 0;
    var cityOk = cityTiers.length === 0 || cityTiers.indexOf(String(row.City_Tier)) >= 0;
    return occOk && cityOk;
  }

  function normalizePointMode(mode) {
    var m = String(mode || "").toLowerCase().trim();
    if (m === "umap") return "umap";
    if (m === "gmm") return "gmm";
    return "pca";
  }

  function findNearestPoint(points, x, y, maxDistance) {
    var threshold = Number.isFinite(maxDistance) ? maxDistance : 18;
    var thresholdSq = threshold * threshold;
    var best = null;
    var bestD2 = Infinity;
    for (var i = 0; i < (points || []).length; i += 1) {
      var p = points[i];
      var dx = p.x - x;
      var dy = p.y - y;
      var d2 = (dx * dx) + (dy * dy);
      if (d2 < bestD2 && d2 <= thresholdSq) {
        bestD2 = d2;
        best = p;
      }
    }
    return best;
  }

  function updatePressureLegend(range) {
    var minEl = byId("pressure-min-label");
    var maxEl = byId("pressure-max-label");
    if (minEl) minEl.textContent = range.min.toFixed(3);
    if (maxEl) maxEl.textContent = range.max.toFixed(3);
  }

  function buildBubbleRows(taskDef) {
    var rows = [];
    var table = taskDef && taskDef.tables && taskDef.tables.interaction_city_occupation_pressure;
    if (!Array.isArray(table)) return rows;
    table.forEach(function (row) {
      var cityTier = row.City_Tier;
      Object.keys(row).forEach(function (key) {
        if (key === "City_Tier") return;
        var pressure = Number(row[key]);
        if (!isFinite(pressure)) return;
        rows.push({
          Segment: cityTier + "|" + key,
          City_Tier: cityTier,
          Occupation: key,
          Pressure_Index_clip: pressure,
          Bubble_Radius: pressure
        });
      });
    });
    return rows;
  }

  function renderHeatmap(taskDef, state) {
    var container = byId("group-heatmap");
    if (!container) return;
    var table = taskDef && taskDef.tables && taskDef.tables.interaction_city_occupation_pressure;
    if (!Array.isArray(table) || table.length === 0) {
      container.innerHTML = "<p class='muted'>No heatmap data.</p>";
      return;
    }
    var occupations = Object.keys(table[0]).filter(function (k) { return k !== "City_Tier"; });
    var range = state.pressureRange;
    var html = "<table class='heatmap-table'><thead><tr><th>City_Tier</th>";
    occupations.forEach(function (occ) {
      html += "<th>" + escapeHtml(occ) + "</th>";
    });
    html += "</tr></thead><tbody>";
    table.forEach(function (row) {
      html += "<tr><th>" + escapeHtml(String(row.City_Tier)) + "</th>";
      occupations.forEach(function (occ) {
        var value = Number(row[occ]);
        var color = pressureToColor(value, range);
        html += "<td style='background:" + color + "'>" + value.toFixed(3) + "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table>";
    container.innerHTML = html;
  }

  function getScatterCoordinates(row, mode) {
    if (mode === "umap") {
      return { x: Number(row.UMAP1), y: Number(row.UMAP2) };
    }
    return { x: Number(row.PCA1), y: Number(row.PCA2) };
  }

  function renderScatterCanvas(rows, mode, state) {
    var canvas = byId("individual-scatter-canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    var width = canvas.width;
    var height = canvas.height;
    var margin = { left: 44, right: 20, top: 18, bottom: 36 };

    var valid = [];
    rows.forEach(function (row) {
      var c = getScatterCoordinates(row, mode);
      var pressure = Number(row.Pressure_Index_clip);
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(pressure)) return;
      valid.push({
        row: row,
        rawX: c.x,
        rawY: c.y,
        pressure: pressure
      });
    });

    var minX = Infinity;
    var maxX = -Infinity;
    var minY = Infinity;
    var maxY = -Infinity;
    valid.forEach(function (p) {
      if (p.rawX < minX) minX = p.rawX;
      if (p.rawX > maxX) maxX = p.rawX;
      if (p.rawY < minY) minY = p.rawY;
      if (p.rawY > maxY) maxY = p.rawY;
    });
    if (!Number.isFinite(minX) || minX === maxX) {
      minX = -1;
      maxX = 1;
    }
    if (!Number.isFinite(minY) || minY === maxY) {
      minY = -1;
      maxY = 1;
    }

    function mapX(v) {
      var t = (v - minX) / (maxX - minX);
      return margin.left + (t * (width - margin.left - margin.right));
    }
    function mapY(v) {
      var t = (v - minY) / (maxY - minY);
      return height - margin.bottom - (t * (height - margin.top - margin.bottom));
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#6b7280";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, height - margin.bottom);
    ctx.lineTo(width - margin.right, height - margin.bottom);
    ctx.stroke();

    ctx.fillStyle = "#d1d5db";
    ctx.font = "12px Consolas, monospace";
    ctx.fillText(mode.toUpperCase() + " X", width - margin.right - 48, height - 10);
    ctx.save();
    ctx.translate(14, margin.top + 48);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(mode.toUpperCase() + " Y", 0, 0);
    ctx.restore();

    var scatterPoints = [];
    valid.forEach(function (p) {
      var x = mapX(p.rawX);
      var y = mapY(p.rawY);
      var color = pressureToColor(p.pressure, state.pressureRange);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.78;
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      scatterPoints.push({
        x: x,
        y: y,
        row: p.row
      });
    });
    ctx.globalAlpha = 1;

    if (state.selectedPoint && state.selectedPoint.row) {
      var selectedId = state.selectedPoint.row.PersonID;
      for (var i = 0; i < scatterPoints.length; i += 1) {
        if (scatterPoints[i].row.PersonID === selectedId) {
          ctx.strokeStyle = "#fde047";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(scatterPoints[i].x, scatterPoints[i].y, 6, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
      }
    }

    state.scatterPoints = scatterPoints;
    if (!state.scatterBound) {
      canvas.addEventListener("click", function (evt) {
        var rect = canvas.getBoundingClientRect();
        var scaleX = canvas.width / rect.width;
        var scaleY = canvas.height / rect.height;
        var x = (evt.clientX - rect.left) * scaleX;
        var y = (evt.clientY - rect.top) * scaleY;
        var nearest = findNearestPoint(state.scatterPoints, x, y, 16);
        if (!nearest) return;
        state.selectedPoint = nearest;

        var pidInput = byId("individual-person-id");
        if (pidInput) pidInput.value = String(nearest.row.PersonID || "");

        var info = byId("individual-selected-info");
        if (info) {
          info.textContent =
            "Selected " + nearest.row.PersonID +
            " | Pressure=" + Number(nearest.row.Pressure_Index_clip).toFixed(3) +
            " | City=" + String(nearest.row.City_Tier || "") +
            " | Occupation=" + String(nearest.row.Occupation || "");
        }

        renderScatterCanvas(rows, state.pointMode, state);
      });
      state.scatterBound = true;
    }
  }

  function applyPointMode(mode, pointCloudEl, state, scatterRows) {
    var normalized = normalizePointMode(mode);
    state.pointMode = normalized;
    state.viewUsage.pca_used = state.viewUsage.pca_used || normalized === "pca";
    state.viewUsage.umap_used = state.viewUsage.umap_used || normalized === "umap";

    var modeLabelEl = byId("point-mode-current");
    if (modeLabelEl) modeLabelEl.textContent = normalized.toUpperCase();

    var buttons = typeof document !== "undefined" ? document.querySelectorAll(".point-mode") : [];
    buttons.forEach(function (btn) {
      var isActive = normalizePointMode(btn.getAttribute("data-mode")) === normalized;
      btn.classList.toggle("active-mode", isActive);
    });

    if (pointCloudEl && typeof pointCloudEl.setAttribute === "function") {
      pointCloudEl.setAttribute("babia-points", "mode", normalized);
    }
    if (scatterRows && scatterRows.length > 0) {
      renderScatterCanvas(scatterRows, normalized, state);
    }
  }

  function getDependentsDataPath(key, fallbackPath) {
    var base = "../1.0.11/data_examples/";
    if (key === "1") return base + "babiaxr_dependents_1.csv";
    if (key === "2") return base + "babiaxr_dependents_2.csv";
    if (key === "3") return base + "babiaxr_dependents_3.csv";
    if (key === "4+") return base + "babiaxr_dependents_4+.csv";
    return fallbackPath || (base + "babiaxr_all_dependents_groups.csv");
  }

  function uniqueValues(rows, field) {
    var map = {};
    (rows || []).forEach(function (row) {
      var value = row[field];
      if (value === undefined || value === null || String(value).trim() === "") return;
      map[String(value)] = true;
    });
    return Object.keys(map).sort();
  }

  function syncSelectedValues(selected, available) {
    var availableMap = {};
    (available || []).forEach(function (v) {
      availableMap[v] = true;
    });
    return (selected || []).filter(function (v) { return !!availableMap[v]; });
  }

  function renderMultiCheck(containerId, values, selected, inputName) {
    var el = byId(containerId);
    if (!el) return;
    var selectedMap = {};
    (selected || []).forEach(function (v) {
      selectedMap[v] = true;
    });
    el.innerHTML = (values || []).map(function (value) {
      var checked = selectedMap[value] ? " checked" : "";
      return (
        "<label><input type='checkbox' name='" + inputName + "' value='" + escapeHtml(value) + "'" + checked + ">" +
        escapeHtml(value) + "</label>"
      );
    }).join("");
    if (!el.innerHTML) {
      el.innerHTML = "<span class='muted'>No options.</span>";
    }
  }

  function readCheckedValuesFrom(containerId, inputName) {
    var container = byId(containerId);
    if (!container) return [];
    var checked = container.querySelectorAll("input[name='" + inputName + "']:checked");
    return Array.prototype.map.call(checked, function (node) { return node.value; });
  }

  function enrichRowsForColor(rows, colorMode, bounds) {
    return (rows || []).map(function (row) {
      var clone = Object.assign({}, row);
      clone.__IncomeNorm = normalizeWithBounds(row.Income, bounds.income);
      clone.__PressureNorm = normalizeWithBounds(row.Pressure_Index_clip, bounds.pressure);
      if (colorMode === "income") {
        clone.__ColorMetric = clone.__IncomeNorm;
      } else if (colorMode === "combined") {
        clone.__ColorHex = computeCombinedColor(clone.__IncomeNorm, clone.__PressureNorm);
      } else {
        clone.__ColorMetric = clone.__PressureNorm;
      }
      return clone;
    });
  }

  function splitRowsByFilters(rows, filters) {
    var active = [];
    var dim = [];
    (rows || []).forEach(function (row) {
      if (matchesStudyFilters(row, filters)) {
        active.push(row);
      } else {
        dim.push(row);
      }
    });
    return { active: active, dim: dim };
  }

  function setTriPointRows(entityId, rows, mode, colorMode, opacity) {
    var el = byId(entityId);
    if (!el || typeof el.setAttribute !== "function") return;
    el.setAttribute("babia-points", "data", JSON.stringify(rows || []));
    el.setAttribute("babia-points", "mode", mode);
    el.setAttribute("babia-points", "opacity", opacity);
    if (colorMode === "combined") {
      el.setAttribute("babia-points", "colorMode", "hex");
      el.setAttribute("babia-points", "color", "__ColorHex");
    } else if (colorMode === "income") {
      el.setAttribute("babia-points", "colorMode", "field");
      el.setAttribute("babia-points", "color", "__ColorMetric");
      el.setAttribute("babia-points", "colorMin", "#330000");
      el.setAttribute("babia-points", "colorMax", "#ff0000");
    } else {
      el.setAttribute("babia-points", "colorMode", "field");
      el.setAttribute("babia-points", "color", "__ColorMetric");
      el.setAttribute("babia-points", "colorMin", "#3a2f0a");
      el.setAttribute("babia-points", "colorMax", "#ffd400");
    }
  }

  function parseViewFromSourceId(sourceId) {
    var s = String(sourceId || "").toLowerCase();
    if (s.indexOf("umap") >= 0) return "umap";
    if (s.indexOf("gmm") >= 0) return "gmm";
    return "pca";
  }

  function setSelectedInfoFromRow(row) {
    var info = byId("individual-selected-info");
    if (!info) return;
    if (!row) {
      info.textContent = "No point selected.";
      return;
    }
    info.textContent =
      "Selected " + String(row.PersonID || "") +
      " | Occupation=" + String(row.Occupation || "") +
      " | City=" + String(row.City_Tier || "") +
      " | Income=" + Number(row.Income || 0).toFixed(1) +
      " | Pressure=" + Number(row.Pressure_Index_clip || 0).toFixed(3) +
      " | Age=" + Number(row.Age || 0).toFixed(0);
  }

  function highlightPersonAcrossTri(state, personId) {
    var ids = [
      "tri-pca-main", "tri-umap-main", "tri-gmm-main",
      "tri-pca-dim", "tri-umap-dim", "tri-gmm-dim"
    ];
    ids.forEach(function (id) {
      var el = byId(id);
      var comp = el && el.components ? el.components["babia-points"] : null;
      if (!comp) return;
      if (comp.clearHighlight) comp.clearHighlight();
      if (!personId || !Array.isArray(comp.newData)) return;
      var index = -1;
      for (var i = 0; i < comp.newData.length; i += 1) {
        if (String(comp.newData[i].PersonID || "") === String(personId)) {
          index = i;
          break;
        }
      }
      if (index >= 0 && comp.setHighlight) {
        comp.setHighlight(index, "#fde047");
      }
    });
  }

  function queueHighlightTri(state, personId) {
    if (typeof window === "undefined") return;
    if (state._highlightTimer) window.clearTimeout(state._highlightTimer);
    state._highlightTimer = window.setTimeout(function () {
      highlightPersonAcrossTri(state, personId);
    }, 50);
  }

  function renderTriPointCloud(state) {
    if (!byId("tri-pointcloud-root")) return;
    var rows = state.triRows || [];
    if (!rows.length) return;

    var bounds = {
      income: getQuantileBounds(rows, "Income", 0.1, 0.9),
      pressure: getQuantileBounds(rows, "Pressure_Index_clip", 0.1, 0.9)
    };
    state.pressureRange = bounds.pressure;
    updatePressureLegend(bounds.pressure);

    var enriched = enrichRowsForColor(rows, state.colorMode, bounds);
    var split = splitRowsByFilters(enriched, state.filters);

    setTriPointRows("tri-pca-main", split.active, "pca", state.colorMode, 0.92);
    setTriPointRows("tri-pca-dim", split.dim, "pca", state.colorMode, 0.12);
    setTriPointRows("tri-umap-main", split.active, "umap", state.colorMode, 0.92);
    setTriPointRows("tri-umap-dim", split.dim, "umap", state.colorMode, 0.12);
    setTriPointRows("tri-gmm-main", split.active, "gmm", state.colorMode, 0.92);
    setTriPointRows("tri-gmm-dim", split.dim, "gmm", state.colorMode, 0.12);

    state.viewUsage.pca_used = true;
    state.viewUsage.umap_used = true;
    state.viewUsage.gmm_used = true;
    state.viewUsage.color_mode = state.colorMode;

    if (state.selectedPersonId) {
      queueHighlightTri(state, state.selectedPersonId);
    }
  }

  function ensureTriGestureBinding(state) {
    if (state.triGestureBound || typeof document === "undefined") return;
    var wraps = document.querySelectorAll(".tri-scene-wrap");
    Array.prototype.forEach.call(wraps, function (wrap) {
      var view = String(wrap.getAttribute("data-tri-view") || "pca").toLowerCase();
      if (!state.triTransforms[view]) {
        state.triTransforms[view] = { rx: 0, ry: 0, scale: 1 };
      }
      var dragging = false;
      var moved = false;
      var lastX = 0;
      var lastY = 0;

      function applyTransform() {
        var root = byId("tri-root-" + view);
        var t = state.triTransforms[view];
        if (!root || !t) return;
        root.setAttribute("rotation", t.rx + " " + t.ry + " 0");
        root.setAttribute("scale", t.scale + " " + t.scale + " " + t.scale);
      }

      wrap.addEventListener("mousedown", function (evt) {
        dragging = true;
        moved = false;
        lastX = evt.clientX;
        lastY = evt.clientY;
        wrap.classList.add("dragging");
      });

      window.addEventListener("mousemove", function (evt) {
        if (!dragging) return;
        var dx = evt.clientX - lastX;
        var dy = evt.clientY - lastY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
        var t = state.triTransforms[view];
        t.ry += dx * 0.25;
        t.rx += dy * 0.25;
        if (t.rx > 85) t.rx = 85;
        if (t.rx < -85) t.rx = -85;
        lastX = evt.clientX;
        lastY = evt.clientY;
        applyTransform();
      });

      window.addEventListener("mouseup", function () {
        if (!dragging) return;
        dragging = false;
        wrap.classList.remove("dragging");
        if (moved) state.suppressSelectionUntil = Date.now() + 180;
      });

      wrap.addEventListener("wheel", function (evt) {
        evt.preventDefault();
        var t = state.triTransforms[view];
        var next = t.scale + ((evt.deltaY < 0) ? 0.08 : -0.08);
        if (next < 0.5) next = 0.5;
        if (next > 3) next = 3;
        t.scale = next;
        applyTransform();
      }, { passive: false });
    });
    state.triGestureBound = true;
  }

  function bindTriSelectionEvents(state) {
    if (state.triSelectionBound || typeof document === "undefined") return;
    ["tri-ray-pca", "tri-ray-umap", "tri-ray-gmm"].forEach(function (rayId) {
      var ray = byId(rayId);
      if (!ray) return;
      ray.addEventListener("babia-points-select", function (evt) {
        if (state.suppressSelectionUntil && Date.now() < state.suppressSelectionUntil) return;
        var detail = (evt && evt.detail) ? evt.detail : {};
        var row = detail.row;
        if (!row) return;
        var personId = String(row.PersonID || "").trim();
        if (!personId) return;
        state.selectedPersonId = personId;
        state.selectedPoint = { row: row };
        state.pointMode = parseViewFromSourceId(detail.sourceId);
        state.viewUsage.pca_used = state.viewUsage.pca_used || state.pointMode === "pca";
        state.viewUsage.umap_used = state.viewUsage.umap_used || state.pointMode === "umap";
        state.viewUsage.gmm_used = state.viewUsage.gmm_used || state.pointMode === "gmm";

        var pidInput = byId("individual-person-id");
        if (pidInput) pidInput.value = personId;

        var modeLabelEl = byId("point-mode-current");
        if (modeLabelEl) modeLabelEl.textContent = state.pointMode.toUpperCase();

        setSelectedInfoFromRow(row);
        queueHighlightTri(state, personId);
      });
    });
    state.triSelectionBound = true;
  }

  function resetTriViews(state) {
    ["pca", "umap", "gmm"].forEach(function (view) {
      state.triTransforms[view] = { rx: 0, ry: 0, scale: 1 };
      var root = byId("tri-root-" + view);
      if (!root) return;
      root.setAttribute("rotation", "0 0 0");
      root.setAttribute("scale", "1 1 1");
    });
    state.selectedPersonId = "";
    highlightPersonAcrossTri(state, "");
    setSelectedInfoFromRow(null);
    var pidInput = byId("individual-person-id");
    if (pidInput) pidInput.value = "";
  }

  function bindTriControlEvents(state, defaultDataPath) {
    if (state.triControlsBound || typeof document === "undefined") return;
    var dependentsSelect = byId("dependents-source");
    if (dependentsSelect) {
      dependentsSelect.addEventListener("change", function () {
        state.dependentsKey = dependentsSelect.value || "all";
        loadTriRowsForDependents(state, defaultDataPath);
      });
    }

    var onFilterChange = function () {
      state.filters.occupations = readCheckedValuesFrom("occupation-filter", "tri-occupation");
      state.filters.cityTiers = readCheckedValuesFrom("citytier-filter", "tri-citytier");
      renderTriPointCloud(state);
    };
    var occContainer = byId("occupation-filter");
    var cityContainer = byId("citytier-filter");
    if (occContainer) occContainer.addEventListener("change", onFilterChange);
    if (cityContainer) cityContainer.addEventListener("change", onFilterChange);

    var colorButtons = document.querySelectorAll(".color-mode");
    Array.prototype.forEach.call(colorButtons, function (btn) {
      btn.addEventListener("click", function () {
        var next = String(btn.getAttribute("data-color-mode") || "pressure").toLowerCase();
        if (["pressure", "income", "combined"].indexOf(next) < 0) next = "pressure";
        state.colorMode = next;
        state.viewUsage.color_mode = next;
        Array.prototype.forEach.call(colorButtons, function (item) {
          item.classList.toggle("active-mode", item === btn);
        });
        renderTriPointCloud(state);
      });
    });

    var resetBtn = byId("tri-reset-view");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        resetTriViews(state);
      });
    }

    state.triControlsBound = true;
  }

  function renderTriFilterOptions(state) {
    var occupations = uniqueValues(state.triRows, "Occupation");
    var cityTiers = uniqueValues(state.triRows, "City_Tier");
    state.filters.occupations = syncSelectedValues(state.filters.occupations, occupations);
    state.filters.cityTiers = syncSelectedValues(state.filters.cityTiers, cityTiers);
    renderMultiCheck("occupation-filter", occupations, state.filters.occupations, "tri-occupation");
    renderMultiCheck("citytier-filter", cityTiers, state.filters.cityTiers, "tri-citytier");
  }

  async function loadTriRowsForDependents(state, defaultDataPath) {
    var path = getDependentsDataPath(state.dependentsKey, defaultDataPath);
    try {
      state.triRows = await loadCsvRows(path);
      renderTriFilterOptions(state);
      renderTriPointCloud(state);
    } catch (err) {
      var info = byId("individual-selected-info");
      if (info) info.textContent = "Failed to load point cloud CSV: " + err.message;
    }
  }

  async function initTriPointCloud(state, defaultDataPath) {
    if (!byId("tri-pointcloud-root")) return;
    state.dependentsKey = "all";
    state.colorMode = "pressure";
    state.filters = state.filters || { occupations: [], cityTiers: [] };
    state.triRows = [];
    state.triTransforms = state.triTransforms || {};
    state.viewUsage.color_mode = "pressure";
    bindTriControlEvents(state, defaultDataPath);
    bindTriSelectionEvents(state);
    ensureTriGestureBinding(state);
    await loadTriRowsForDependents(state, defaultDataPath);
  }

  function getGroupTasks(taskDef) {
    if (taskDef && taskDef.group_endpoint && Array.isArray(taskDef.group_endpoint.tasks)) {
      return taskDef.group_endpoint.tasks;
    }
    return taskDef.tasks || [];
  }

  async function init(options) {
    options = options || {};
    var conditionId = options.conditionId;
    var tasksPath = options.tasksPath || "./study_tasks.json";
    var conditionsPath = options.conditionsPath || "./study_conditions.json";
    var dataPath = options.dataPath || "../1.0.11/data_examples/babiaxr_all_dependents_groups.csv";

    var state = {
      clicks: 0,
      startedAt: new Date(),
      participantId: "",
      conditionId: conditionId,
      pointMode: "pca",
      colorMode: "pressure",
      dependentsKey: "all",
      viewUsage: { pca_used: false, umap_used: false, gmm_used: false, color_mode: "pressure" },
      pressureRange: { min: 0, max: 1 },
      scatterPoints: [],
      selectedPoint: null,
      selectedPersonId: "",
      scatterBound: false,
      triRows: [],
      filters: { occupations: [], cityTiers: [] },
      triControlsBound: false,
      triSelectionBound: false,
      triGestureBound: false,
      triTransforms: {},
      suppressSelectionUntil: 0,
      _highlightTimer: null
    };

    document.addEventListener("click", function () {
      state.clicks += 1;
    });

    var taskDef = await fetch(tasksPath).then(function (r) { return r.json(); });
    var conditionDef = await fetch(conditionsPath).then(function (r) { return r.json(); });
    var condition = (conditionDef.conditions || []).find(function (c) { return c.id === conditionId; });
    if (!condition) throw new Error("Unknown condition id: " + conditionId);

    var groupTasks = getGroupTasks(taskDef);
    var individualSpec = taskDef.individual_endpoint || null;
    var defaultPointMode = normalizePointMode(
      taskDef.point_cloud_defaults && taskDef.point_cloud_defaults.default_mode
        ? taskDef.point_cloud_defaults.default_mode
        : "pca"
    );

    var rawRows = [];
    var hasTri = !!byId("tri-pointcloud-root");
    var needsRows = !!byId("individual-scatter-canvas") || !!byId("individual-points") || hasTri;
    if (needsRows) {
      try {
        rawRows = await loadCsvRows(dataPath);
      } catch (err) {
        var infoErr = byId("individual-selected-info");
        if (infoErr) infoErr.textContent = "Failed to load data: " + err.message;
      }
    }
    if (rawRows.length > 0) {
      state.pressureRange = computePressureRange(rawRows);
    }
    updatePressureLegend(state.pressureRange);
    renderHeatmap(taskDef, state);

    var showTables = options.showTables;
    if (showTables === undefined || showTables === null) {
      showTables = condition.interface_type !== "vr";
    }

    var headerEl = byId("study-header");
    if (headerEl) {
      headerEl.innerHTML =
        "<h2>" + escapeHtml(taskDef.study_id) + " / " + escapeHtml(condition.label) + "</h2>" +
        "<p>" + escapeHtml(condition.description) + "</p>" +
        "<p><strong>Focus:</strong> " + escapeHtml(taskDef.focus_metric) + "</p>";
    }

    var tablesEl = byId("study-tables");
    if (tablesEl) {
      if (showTables && taskDef.tables) {
        var html = "";
        html += renderTable("City Tier Means (Pressure)", taskDef.tables.city_means || []);
        html += renderTable("City x Occupation Means (Pressure)", taskDef.tables.interaction_city_occupation_pressure || []);
        tablesEl.innerHTML = html;
      } else {
        tablesEl.innerHTML = "<section class='panel'><p class='muted'>Reference tables are hidden in this condition. Use heatmap/scatter or VR scene.</p></section>";
      }
    }

    var bubbleEl = byId("vr-bubble-chart");
    if (bubbleEl) {
      var bubbleRows = buildBubbleRows(taskDef);
      if (bubbleRows.length > 0) {
        bubbleEl.setAttribute("babia-bubbles", "data", JSON.stringify(bubbleRows));
      }
    }

    var pointCloudEl = byId("individual-points");
    applyPointMode(defaultPointMode, pointCloudEl, state, rawRows);
    var modeButtons = document.querySelectorAll(".point-mode");
    modeButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var mode = btn.getAttribute("data-mode") || "pca";
        applyPointMode(mode, pointCloudEl, state, rawRows);
      });
    });

    var cardsEl = byId("study-ai-cards");
    if (cardsEl) {
      if (condition.ai_assist) {
        var cards = (taskDef.ai_cards || []).map(function (card) {
          return "<article class='card'><h4>" + escapeHtml(card.title) + "</h4><p>" + escapeHtml(card.text) + "</p></article>";
        }).join("");
        cardsEl.innerHTML = "<h3>AI(ML) Insight Cards</h3>" + cards;
      } else {
        cardsEl.innerHTML = "<h3>AI(ML) Insight Cards</h3><p class='muted'>Not available in this condition.</p>";
      }
    }

    var tasksEl = byId("study-tasks");
    if (tasksEl) {
      var formHtml = "<form id='task-form'>";

      formHtml += "<section class='panel task-panel'><h3>Group Tasks (60%)</h3>";
      groupTasks.forEach(function (task) {
        formHtml += "<fieldset class='task'><legend>" + escapeHtml(task.id + ". " + task.prompt) + "</legend>";
        (task.options || []).forEach(function (opt) {
          var safe = escapeHtml(opt);
          var inputType = task.type === "multi_choice" ? "checkbox" : "radio";
          formHtml += "<label class='option'><input type='" + inputType + "' name='" + escapeHtml(task.id) + "' value='" + safe + "'/> " + safe + "</label>";
        });
        formHtml += "</fieldset>";
      });
      formHtml += "</section>";

      if (individualSpec) {
        var requiredEvidenceCount = Number(individualSpec.required_evidence_count || 2);
        formHtml += "<section class='panel task-panel'><h3>Individual Task (40%)</h3>";
        formHtml += "<p class='muted'>" + escapeHtml(individualSpec.prompt || "Select one person and choose evidence tags.") + "</p>";
        formHtml += "<label>Selected PersonID (click a scatter/point-cloud point)<input id='individual-person-id' placeholder='e.g. PID_000075' required></label>";
        formHtml += "<p class='muted'>Select exactly " + requiredEvidenceCount + " evidence tags:</p>";
        (individualSpec.evidence_options || []).forEach(function (tag) {
          var safeTag = escapeHtml(tag);
          formHtml += "<label class='option'><input type='checkbox' name='individual-evidence' value='" + safeTag + "'/> " + safeTag + "</label>";
        });
        formHtml += "<p class='muted'>Current source view: <span class='mono' id='point-mode-current'>" + defaultPointMode.toUpperCase() + "</span></p>";
        formHtml += "</section>";
      }

      formHtml += "<label>Participant ID (metadata, not a question; required for filename/scoring) <input id='participant-id' required placeholder='e.g. P001'/></label>";
      formHtml += "<label>Short rationale (metadata only; optional, not scored) <textarea id='participant-rationale' rows='3' placeholder='one sentence on how you decided'></textarea></label>";
      formHtml += "<button type='submit'>Submit And Download Log</button>";
      formHtml += "</form>";
      tasksEl.innerHTML = formHtml;

      var formEl = byId("task-form");
      formEl.addEventListener("submit", function (event) {
        event.preventDefault();
        var participantInput = byId("participant-id");
        state.participantId = participantInput ? participantInput.value.trim() : "";
        if (!state.participantId) {
          alert("Participant ID is required.");
          return;
        }

        var groupAnswers = collectTaskAnswers(groupTasks, formEl);
        var individualPayload = {};
        if (individualSpec) {
          var personInput = byId("individual-person-id");
          var selectedPersonId = personInput ? String(personInput.value || "").trim() : "";
          if (!selectedPersonId) {
            alert("PersonID is required for the individual task.");
            return;
          }

          var evidenceTags = collectCheckedValues(formEl, "individual-evidence");
          var requiredEvidenceCount = Number(individualSpec.required_evidence_count || 2);
          if (evidenceTags.length !== requiredEvidenceCount) {
            alert("Please select exactly " + requiredEvidenceCount + " evidence tags.");
            return;
          }

          var now = new Date();
          individualPayload = {
            selected_person_id: selectedPersonId,
            evidence_tags: evidenceTags,
            duration_seconds: (now.getTime() - state.startedAt.getTime()) / 1000.0,
            point_mode: state.pointMode,
            color_mode: state.colorMode
          };
        }

        var endedAt = new Date();
        var durationSeconds = (endedAt.getTime() - state.startedAt.getTime()) / 1000.0;
        var payload = {
          study_id: taskDef.study_id,
          participant_id: state.participantId,
          condition_id: condition.id,
          interface_type: condition.interface_type,
          ai_assist: !!condition.ai_assist,
          started_at: state.startedAt.toISOString(),
          ended_at: endedAt.toISOString(),
          duration_seconds: durationSeconds,
          interaction_counts: { clicks: state.clicks },
          view_usage: state.viewUsage,
          rationale: byId("participant-rationale") ? byId("participant-rationale").value : "",
          answers: groupAnswers,
          individual: individualPayload
        };

        var stamp = endedAt.toISOString().replace(/[:.]/g, "-");
        var filename = "pressure-study-" + condition.id + "-" + state.participantId + "-" + stamp + ".json";
        downloadJson(filename, payload);

        var statusEl = byId("study-status");
        if (statusEl) {
          statusEl.textContent = "Saved: " + filename + " | Duration: " + durationSeconds.toFixed(1) + " sec";
        }
      });
    }

    if (hasTri) {
      await initTriPointCloud(state, dataPath);
    }

    var scoreHelpEl = byId("score-help");
    if (scoreHelpEl) {
      scoreHelpEl.textContent =
        "Score with: python tools/research/pressure_study_scoring.py --study examples/demos/ai_vr_pressure/study_tasks.json --submission <your_log.json>";
    }
  }

  var api = { init: init };
  var internal = {
    parseCsvText: parseCsvText,
    computePressureRange: computePressureRange,
    findNearestPoint: findNearestPoint,
    getQuantileBounds: getQuantileBounds,
    normalizeWithBounds: normalizeWithBounds,
    matchesStudyFilters: matchesStudyFilters,
    computeCombinedColor: computeCombinedColor
  };

  if (typeof window !== "undefined") {
    window.PressureStudy = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { PressureStudy: api, _internal: internal };
  }
})();
