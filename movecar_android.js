// ── Constants ──────────────────────────────────────────────────────────
const KV_PREFIX_CONFIG = "v_config:";
const CONFIG = { KV_TTL: 3600 };

// ── KV Utils ──────────────────────────────────────────────────────────

async function getVehicleConfig(vehicleId) {
  const config = await MOVE_CAR_STATUS.get(KV_PREFIX_CONFIG + vehicleId);
  return config ? JSON.parse(config) : null;
}

async function listVehicles() {
  const list = await MOVE_CAR_STATUS.list({ prefix: KV_PREFIX_CONFIG });
  const vehicles = {};
  for (const key of list.keys) {
    const id = key.name.split(":")[1];
    const v = await getVehicleConfig(id);
    if (v) vehicles[id] = v;
  }
  return vehicles;
}

async function saveVehicleConfig(vehicle) {
  await MOVE_CAR_STATUS.put(KV_PREFIX_CONFIG + vehicle.id, JSON.stringify(vehicle));
}

async function deleteVehicleConfig(vehicleId) {
  await MOVE_CAR_STATUS.delete(KV_PREFIX_CONFIG + vehicleId);
}

function generateVehicleId(existingIds) {
  let id;
  do {
    id = Math.floor(100000 + Math.random() * 900000).toString();
  } while (existingIds.includes(id));
  return id;
}

function getVehicleStatusKey(vehicleId) {
  return "status_" + vehicleId;
}

function getRequesterLocationKey(vehicleId) {
  return "req_loc_" + vehicleId;
}

function getOwnerLocationKey(vehicleId) {
  return "own_loc_" + vehicleId;
}

// ── Auth Utils ─────────────────────────────────────────────────────────

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie");
  if (cookie) {
    const parts = cookie.split("; ");
    for (const part of parts) {
      const [key, value] = part.split("=");
      if (key === name) return value;
    }
  }
  return null;
}

// ── Main Router ────────────────────────────────────────────────────────

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // ── Super Admin ─────────────────────────────────────────────────────
  if (path === "/admin") {
    const token = getCookie(request, "admin_token");
    if (typeof SUPER_ADMIN_PASSWD !== 'undefined' && token === SUPER_ADMIN_PASSWD) {
      const vehicles = await listVehicles();
      return new Response(await renderAdminPage(vehicles), { headers: { "Content-Type": "text/html;charset=UTF-8" } });
    }
    return new Response(renderAdminLogin(), { headers: { "Content-Type": "text/html;charset=UTF-8" } });
  }

  if (path === "/api/admin/login" && request.method === "POST") {
    const body = await request.json();
    if (typeof SUPER_ADMIN_PASSWD !== 'undefined' && body.password === SUPER_ADMIN_PASSWD) {
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "admin_token=" + SUPER_ADMIN_PASSWD + "; Path=/; HttpOnly; SameSite=Lax"
        },
      });
    }
    return new Response(JSON.stringify({ success: false }), { status: 401 });
  }

  if (path === "/api/admin/vehicle") {
    const token = getCookie(request, "admin_token");
    if (typeof SUPER_ADMIN_PASSWD === 'undefined' || token !== SUPER_ADMIN_PASSWD) return new Response("Unauthorized", { status: 401 });

    if (request.method === "POST") {
      const v = await request.json();
      if (!v.id) {
        const vehicles = await listVehicles();
        v.id = generateVehicleId(Object.keys(vehicles));
        v.enabled = true;
      } else {
        const existing = await getVehicleConfig(v.id);
        v.enabled = existing ? existing.enabled : true;
      }
      await saveVehicleConfig(v);
      return new Response(JSON.stringify({ success: true }));
    } else if (request.method === "DELETE") {
      const id = url.searchParams.get("id");
      await deleteVehicleConfig(id);
      return new Response(JSON.stringify({ success: true }));
    }
  }

  if (path === "/api/admin/vehicle/toggle" && request.method === "POST") {
    const token = getCookie(request, "admin_token");
    if (typeof SUPER_ADMIN_PASSWD === 'undefined' || token !== SUPER_ADMIN_PASSWD) return new Response("Unauthorized", { status: 401 });

    const id = url.searchParams.get("id");
    const v = await getVehicleConfig(id);
    if (v) {
      v.enabled = !v.enabled;
      await saveVehicleConfig(v);
    }
    return new Response(JSON.stringify({ success: true }));
  }

  // ── Vehicle Admin & Public ──────────────────────────────────────────

  const vehicleMatch = path.match(/^\/v\/(\d{6})(\/admin)?$/);
  if (vehicleMatch) {
    const vehicleId = vehicleMatch[1];
    const isAdmin = !!vehicleMatch[2];
    const vehicle = await getVehicleConfig(vehicleId);

    if (!vehicle || (!vehicle.enabled && !isAdmin)) {
      return new Response("此车辆不存在或已被禁用", { status: 404 });
    }

    if (isAdmin) {
      const token = getCookie(request, "v_token_" + vehicleId);
      if (token === vehicle.admin_passwd) {
        return new Response(await renderVehicleAdminPage(vehicle), { headers: { "Content-Type": "text/html;charset=UTF-8" } });
      }
      return new Response(renderVehicleLogin(vehicleId), { headers: { "Content-Type": "text/html;charset=UTF-8" } });
    }

    return renderMainPage(url.origin, vehicle);
  }

  // ── API for specific vehicle ────────────────────────────────────────

  const apiMatch = path.match(/^\/api\/v\/(\d{6})\/(.*)$/);
  if (apiMatch) {
    const vehicleId = apiMatch[1];
    const apiPath = apiMatch[2];
    const vehicle = await getVehicleConfig(vehicleId);

    if (!vehicle) return new Response("Not Found", { status: 404 });

    if (apiPath === "login" && request.method === "POST") {
      const body = await request.json();
      if (body.password === vehicle.admin_passwd) {
        return new Response(JSON.stringify({ success: true }), {
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": "v_token_" + vehicleId + "=" + vehicle.admin_passwd + "; Path=/; HttpOnly; SameSite=Lax"
          },
        });
      }
      return new Response(JSON.stringify({ success: false }), { status: 401 });
    }

    if (apiPath === "settings" && request.method === "POST") {
      const token = getCookie(request, "v_token_" + vehicleId);
      if (token !== vehicle.admin_passwd) return new Response("Unauthorized", { status: 401 });
      const body = await request.json();
      vehicle.plate = body.plate;
      vehicle.phone = body.phone;
      vehicle.push_configs = body.push_configs;
      await saveVehicleConfig(vehicle);
      return new Response(JSON.stringify({ success: true }));
    }

    if (apiPath === "notify" && request.method === "POST") {
      return handleNotify(request, url, vehicle);
    }

    if (apiPath === "check-status") {
      const status = await MOVE_CAR_STATUS.get(getVehicleStatusKey(vehicleId));
      const ownerLocation = await MOVE_CAR_STATUS.get(getOwnerLocationKey(vehicleId));
      return new Response(
        JSON.stringify({
          status: status || "waiting",
          ownerLocation: ownerLocation ? JSON.parse(ownerLocation) : null,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
  }

  // legacy / special paths
  if (path === "/api/get-location") {
    const vehicleId = url.searchParams.get("v");
    const data = await MOVE_CAR_STATUS.get(getRequesterLocationKey(vehicleId));
    if (data) return new Response(data, { headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ error: "No location" }), { status: 404 });
  }

  if (path === "/api/owner-confirm" && request.method === "POST") {
    const vehicleId = url.searchParams.get("v");
    return handleOwnerConfirmAction(request, vehicleId);
  }

  if (path === "/owner-confirm") {
    const vehicleId = url.searchParams.get("v");
    return renderOwnerPage(vehicleId);
  }

  return new Response("Not Found", { status: 404 });
}

// ── Helpers ──────────────────────────────────────────────────────────────

function wgs84ToGcj02(lat, lng) {
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  if (outOfChina(lat, lng)) return { lat, lng };
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}

function outOfChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

function generateMapUrls(lat, lng) {
  const gcj = wgs84ToGcj02(lat, lng);
  return {
    amapUrl: "https://uri.amap.com/marker?position=" + gcj.lng + "," + gcj.lat + "&name=位置",
    appleUrl: "https://maps.apple.com/?ll=" + gcj.lat + "," + gcj.lng + "&q=位置",
  };
}

async function handlePushNotify(vehicle, notifyBody, confirmLink) {
  const pushConfigs = vehicle.push_configs || (vehicle.push_config ? [vehicle.push_config] : []);
  const title = "🚗 挪车请求";
  const fullBody = notifyBody + confirmLink;

  const results = await Promise.all(pushConfigs.map(async (config) => {
    try {
      if (config.type === 'server_chan') {
        const scResponse = await fetch("https://sctapi.ftqq.com/" + config.url + ".send", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "title=" + encodeURIComponent(title) + "&desp=" + encodeURIComponent(fullBody),
        });
        return scResponse.ok;
      } else if (config.type === 'webhook') {
        const response = await fetch(config.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, message: fullBody, vehicle_id: vehicle.id, plate: vehicle.plate }),
        });
        return response.ok;
      } else if (config.type === 'gotify') {
        const response = await fetch(config.url + "/message?token=" + config.token, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, message: fullBody, priority: 5 }),
        });
        return response.ok;
      }
    } catch (e) {}
    return false;
  }));

  return results.some(r => r === true);
}

async function handleNotify(request, url, vehicle) {
  try {
    const body = await request.json();
    const message = body.message || "车旁有人等待";
    const location = body.location || null;
    const delayed = body.delayed || false;

    const confirmUrl = encodeURIComponent(url.origin + "/owner-confirm?v=" + vehicle.id);

    let notifyBody = "🚗 挪车请求 (" + vehicle.plate + ")";
    if (message) notifyBody += "\n💬 留言: " + message;

    if (location && location.lat && location.lng) {
      const urls = generateMapUrls(location.lat, location.lng);
      notifyBody += "\n📍 已附带位置信息，点击查看";
      await MOVE_CAR_STATUS.put(getRequesterLocationKey(vehicle.id), JSON.stringify({ lat: location.lat, lng: location.lng, ...urls }), { expirationTtl: CONFIG.KV_TTL });
    } else {
      notifyBody += "\n⚠️ 未提供位置信息";
    }

    await MOVE_CAR_STATUS.put(getVehicleStatusKey(vehicle.id), "waiting", { expirationTtl: 600 });

    if (delayed) {
      await new Promise((resolve) => setTimeout(resolve, 300000));
    }

    const confirmLink = "\n\n[👉 点击确认挪车](" + decodeURIComponent(confirmUrl) + ")";
    const success = await handlePushNotify(vehicle, notifyBody, confirmLink);
    if (!success) throw new Error("Push API Error");

    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
  }
}

async function handleOwnerConfirmAction(request, vehicleId) {
  try {
    const body = await request.json();
    const ownerLocation = body.location || null;

    if (ownerLocation) {
      const urls = generateMapUrls(ownerLocation.lat, ownerLocation.lng);
      await MOVE_CAR_STATUS.put(getOwnerLocationKey(vehicleId), JSON.stringify({ lat: ownerLocation.lat, lng: ownerLocation.lng, ...urls, timestamp: Date.now() }), { expirationTtl: CONFIG.KV_TTL });
    }

    await MOVE_CAR_STATUS.put(getVehicleStatusKey(vehicleId), "confirmed", { expirationTtl: 600 });
    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    await MOVE_CAR_STATUS.put(getVehicleStatusKey(vehicleId), "confirmed", { expirationTtl: 600 });
    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
  }
}

// ── Views ────────────────────────────────────────────────────────────────

const COMMON_STYLE = " :root { --sat: env(safe-area-inset-top, 0px); --sar: env(safe-area-inset-right, 0px); --sab: env(safe-area-inset-bottom, 0px); --sal: env(safe-area-inset-left, 0px); } * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; margin: 0; padding: 0; } body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif; background: linear-gradient(160deg, #0093E9 0%, #80D0C7 100%); min-height: 100vh; padding: 20px; display: flex; justify-content: center; align-items: flex-start; } .container { width: 100%; max-width: 800px; display: flex; flex-direction: column; gap: 20px; } .card { background: rgba(255, 255, 255, 0.95); border-radius: 24px; padding: 24px; box-shadow: 0 10px 40px rgba(0, 147, 233, 0.2); } h1 { font-size: 24px; font-weight: 700; color: #1a202c; margin-bottom: 20px; text-align: center; } table { width: 100%; border-collapse: collapse; margin-top: 10px; } th, td { padding: 12px; text-align: left; border-bottom: 1px solid #edf2f7; } th { color: #718096; font-weight: 600; text-transform: uppercase; font-size: 12px; letter-spacing: 0.05em; } td { color: #2d3748; font-size: 14px; } button { background: #0093E9; color: white; border: none; padding: 8px 16px; border-radius: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s; font-size: 13px; margin-right: 4px; } button:active { transform: scale(0.98); } button.secondary { background: #edf2f7; color: #4a5568; } button.danger { background: #fff5f5; color: #c53030; } .modal { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); align-items: center; justify-content: center; } .modal-content { background: white; width: 90%; max-width: 500px; border-radius: 28px; padding: 32px; box-shadow: 0 20px 60px rgba(0,0,0,0.2); max-height: 90vh; overflow-y: auto; } .form-group { margin-bottom: 16px; } label { display: block; margin-bottom: 6px; font-weight: 600; color: #4a5568; font-size: 14px; } input, select { width: 100%; padding: 12px; border-radius: 12px; border: 1px solid #e2e8f0; outline: none; transition: border-color 0.2s; font-size: 15px; } input:focus { border-color: #0093E9; } .push-item { border: 1px solid #e2e8f0; padding: 16px; border-radius: 16px; margin-bottom: 12px; position: relative; } .push-remove { position: absolute; right: 8px; top: 8px; color: #e53e3e; cursor: pointer; font-size: 18px; }";

async function renderAdminPage(vehicles) {
  const vehicleListHtml = Object.values(vehicles).map(v => '<tr><td>' + v.id + '</td><td>' + v.plate + '</td><td>' + (v.enabled ? '✅ 启用' : '❌ 禁用') + '</td><td>' + v.phone + '</td><td><button onclick="editVehicle(\'' + v.id + '\')">编辑</button> <button class="secondary" onclick="toggleVehicle(\'' + v.id + '\')">' + (v.enabled ? '禁用' : '启用') + '</button> <button class="danger" onclick="deleteVehicle(\'' + v.id + '\')">删除</button></td></tr>').join('');

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>超级管理员控制台</title>
    <style>` + COMMON_STYLE + `</style>
  </head>
  <body>
    <div class="container">
      <div class="card">
        <h1>超级管理员控制台</h1>
        <div style="margin-bottom: 20px; display: flex; justify-content: space-between;">
          <button onclick="showAddModal()">+ 添加车辆</button>
          <button class="secondary" onclick="logout()">退出登录</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>车牌号</th>
              <th>状态</th>
              <th>电话</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>` + vehicleListHtml + `</tbody>
        </table>
      </div>
    </div>

    <div id="vehicleModal" class="modal">
      <div class="modal-content">
        <h2 id="modalTitle" style="margin-bottom: 24px;">添加车辆</h2>
        <input type="hidden" id="vehicleId">
        <div class="form-group">
          <label>车牌号</label>
          <input type="text" id="plate">
        </div>
        <div class="form-group">
          <label>管理密码</label>
          <input type="text" id="adminPasswd">
        </div>
        <div class="form-group">
          <label>紧急电话</label>
          <input type="text" id="phone">
        </div>

        <div style="margin-top: 24px;">
          <label style="display: flex; justify-content: space-between; align-items: center;">
            推送配置
            <button class="secondary" style="padding: 4px 8px; font-size: 12px;" onclick="addPushConfig()">+ 添加</button>
          </label>
          <div id="pushConfigsContainer"></div>
        </div>

        <div style="margin-top: 32px; display: flex; gap: 12px;">
          <button style="flex: 1; padding: 14px;" onclick="saveVehicle()">保存</button>
          <button class="secondary" style="flex: 1; padding: 14px;" onclick="closeModal()">取消</button>
        </div>
      </div>
    </div>

    <script>
      (function() {
        let vehicles = ` + JSON.stringify(vehicles) + `;

        window.showAddModal = function() {
          document.getElementById('modalTitle').innerText = '添加车辆';
          document.getElementById('vehicleId').value = '';
          document.getElementById('plate').value = '';
          document.getElementById('adminPasswd').value = Math.random().toString(36).slice(-8);
          document.getElementById('phone').value = '';
          document.getElementById('pushConfigsContainer').innerHTML = '';
          addPushConfig();
          document.getElementById('vehicleModal').style.display = 'flex';
        }

        window.editVehicle = function(id) {
          const v = vehicles[id];
          document.getElementById('modalTitle').innerText = '编辑车辆';
          document.getElementById('vehicleId').value = v.id;
          document.getElementById('plate').value = v.plate;
          document.getElementById('adminPasswd').value = v.admin_passwd;
          document.getElementById('phone').value = v.phone;
          document.getElementById('pushConfigsContainer').innerHTML = '';
          const configs = v.push_configs || (v.push_config ? [v.push_config] : []);
          configs.forEach(c => addPushConfig(c));
          document.getElementById('vehicleModal').style.display = 'flex';
        }

        window.closeModal = function() {
          document.getElementById('vehicleModal').style.display = 'none';
        }

        window.addPushConfig = function(config = { type: 'server_chan', url: '', token: '' }) {
          const container = document.getElementById('pushConfigsContainer');
          const div = document.createElement('div');
          div.className = 'push-item';
          div.innerHTML = '<span class="push-remove" onclick="this.parentElement.remove()">×</span>' +
            '<div class="form-group"><label>类型</label><select class="p-type" onchange="updatePushInputs(this)">' +
            '<option value="server_chan" ' + (config.type === 'server_chan' ? 'selected' : '') + '>Server酱</option>' +
            '<option value="webhook" ' + (config.type === 'webhook' ? 'selected' : '') + '>Webhook</option>' +
            '<option value="gotify" ' + (config.type === 'gotify' ? 'selected' : '') + '>Gotify</option>' +
            '</select></div>' +
            '<div class="form-group"><label class="p-url-label">' + (config.type === 'server_chan' ? 'SendKey' : 'URL') + '</label>' +
            '<input type="text" class="p-url" value="' + config.url + '"></div>' +
            '<div class="form-group p-token-group" style="display: ' + (config.type === 'gotify' ? 'block' : 'none') + '">' +
            '<label>Token</label><input type="text" class="p-token" value="' + (config.token || '') + '"></div>';
          container.appendChild(div);
        }

        window.updatePushInputs = function(el) {
          const item = el.parentElement.parentElement;
          const type = el.value;
          item.querySelector('.p-url-label').innerText = (type === 'server_chan' ? 'SendKey' : 'URL');
          item.querySelector('.p-token-group').style.display = (type === 'gotify' ? 'block' : 'none');
        }

        window.saveVehicle = async function() {
          const push_configs = Array.from(document.querySelectorAll('.push-item')).map(item => ({
            type: item.querySelector('.p-type').value,
            url: item.querySelector('.p-url').value,
            token: item.querySelector('.p-token').value
          }));

          const data = {
            id: document.getElementById('vehicleId').value,
            plate: document.getElementById('plate').value,
            admin_passwd: document.getElementById('adminPasswd').value,
            phone: document.getElementById('phone').value,
            push_configs
          };

          const res = await fetch('/api/admin/vehicle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });

          if (res.ok) location.reload();
        }

        window.deleteVehicle = async function(id) {
          if (!confirm('确认删除？')) return;
          await fetch('/api/admin/vehicle?id=' + id, { method: 'DELETE' });
          location.reload();
        }

        window.toggleVehicle = async function(id) {
          await fetch('/api/admin/vehicle/toggle?id=' + id, { method: 'POST' });
          location.reload();
        }

        window.logout = function() {
          document.cookie = "admin_token=; Max-Age=0; Path=/";
          location.reload();
        }
      })();
    </script>
  </body>
  </html>
  `;
}

function renderAdminLogin() {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理员登录</title>
    <style>` + COMMON_STYLE + ` body { align-items: center; } .login-card { width: 100%; max-width: 400px; text-align: center; }</style>
  </head>
  <body>
    <div class="login-card card">
      <h1 style="margin-bottom: 32px;">超级管理员登录</h1>
      <div class="form-group">
        <input type="password" id="password" placeholder="请输入超级管理员密码">
      </div>
      <button style="width: 100%; padding: 14px; margin-top: 10px;" onclick="login()">登录</button>
    </div>
    <script>
      window.login = async function() {
        const password = document.getElementById('password').value;
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        if (res.ok) location.reload();
        else alert('密码错误');
      }
    </script>
  </body>
  </html>
  `;
}

async function renderVehicleAdminPage(v) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>车辆管理 - ` + v.plate + `</title>
    <style>` + COMMON_STYLE + `</style>
  </head>
  <body>
    <div class="container" style="max-width: 500px;">
      <div class="card">
        <h1>车辆设置</h1>
        <p style="text-align: center; color: #718096; margin-bottom: 24px; font-size: 14px;">ID: ` + v.id + `</p>

        <div class="form-group">
          <label>车牌号</label>
          <input type="text" id="plate" value="` + v.plate + `">
        </div>
        <div class="form-group">
          <label>紧急电话</label>
          <input type="text" id="phone" value="` + v.phone + `">
        </div>

        <div style="margin-top: 24px;">
          <label style="display: flex; justify-content: space-between; align-items: center;">
            推送配置
            <button class="secondary" style="padding: 4px 8px; font-size: 12px;" onclick="addPushConfig()">+ 添加</button>
          </label>
          <div id="pushConfigsContainer"></div>
        </div>

        <button style="width: 100%; padding: 14px; margin-top: 32px;" onclick="saveSettings()">保存修改</button>
        <button class="secondary" style="width: 100%; padding: 14px; margin-top: 12px;" onclick="location.href='/v/` + v.id + `'">预览挪车页面</button>
        <button class="danger" style="width: 100%; padding: 14px; margin-top: 12px; background: transparent; border: 1px solid #fed7d7;" onclick="logout()">退出登录</button>
      </div>
    </div>

    <script>
      (function() {
        const vId = "` + v.id + `";
        const initialConfigs = ` + JSON.stringify(v.push_configs || (v.push_config ? [v.push_config] : [])) + `;

        window.onload = () => {
          initialConfigs.forEach(c => addPushConfig(c));
        };

        window.addPushConfig = function(config = { type: 'server_chan', url: '', token: '' }) {
          const container = document.getElementById('pushConfigsContainer');
          const div = document.createElement('div');
          div.className = 'push-item';
          div.innerHTML = '<span class="push-remove" onclick="this.parentElement.remove()">×</span>' +
            '<div class="form-group"><label>类型</label><select class="p-type" onchange="updatePushInputs(this)">' +
            '<option value="server_chan" ' + (config.type === 'server_chan' ? 'selected' : '') + '>Server酱</option>' +
            '<option value="webhook" ' + (config.type === 'webhook' ? 'selected' : '') + '>Webhook</option>' +
            '<option value="gotify" ' + (config.type === 'gotify' ? 'selected' : '') + '>Gotify</option>' +
            '</select></div>' +
            '<div class="form-group"><label class="p-url-label">' + (config.type === 'server_chan' ? 'SendKey' : 'URL') + '</label>' +
            '<input type="text" class="p-url" value="' + config.url + '"></div>' +
            '<div class="form-group p-token-group" style="display: ' + (config.type === 'gotify' ? 'block' : 'none') + '">' +
            '<label>Token</label><input type="text" class="p-token" value="' + (config.token || '') + '"></div>';
          container.appendChild(div);
        }

        window.updatePushInputs = function(el) {
          const item = el.parentElement.parentElement;
          const type = el.value;
          item.querySelector('.p-url-label').innerText = (type === 'server_chan' ? 'SendKey' : 'URL');
          item.querySelector('.p-token-group').style.display = (type === 'gotify' ? 'block' : 'none');
        }

        window.saveSettings = async function() {
          const push_configs = Array.from(document.querySelectorAll('.push-item')).map(item => ({
            type: item.querySelector('.p-type').value,
            url: item.querySelector('.p-url').value,
            token: item.querySelector('.p-token').value
          }));

          const data = {
            plate: document.getElementById('plate').value,
            phone: document.getElementById('phone').value,
            push_configs
          };

          const res = await fetch('/api/v/' + vId + '/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });

          if (res.ok) alert('保存成功');
          else alert('保存失败');
        }

        window.logout = function() {
          document.cookie = "v_token_" + vId + "=; Max-Age=0; Path=/";
          location.reload();
        }
      })();
    </script>
  </body>
  </html>
  `;
}

function renderVehicleLogin(vehicleId) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>车辆管理登录</title>
    <style>` + COMMON_STYLE + ` body { align-items: center; } .login-card { width: 100%; max-width: 400px; text-align: center; }</style>
  </head>
  <body>
    <div class="login-card card">
      <h1 style="margin-bottom: 8px;">车辆管理登录</h1>
      <p style="color: #718096; margin-bottom: 32px;">车辆 ID: ` + vehicleId + `</p>
      <div class="form-group">
        <input type="password" id="password" placeholder="请输入管理密码">
      </div>
      <button style="width: 100%; padding: 14px; margin-top: 10px;" onclick="login()">登录</button>
    </div>
    <script>
      window.login = async function() {
        const password = document.getElementById('password').value;
        const res = await fetch("/api/v/` + vehicleId + `/login", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        if (res.ok) location.reload();
        else alert('密码错误');
      }
    </script>
  </body>
  </html>
  `;
}

function renderMainPage(origin, vehicle) {
  const phone = vehicle.phone;
  const plate = vehicle.plate;
  const vehicleId = vehicle.id;

  const html = /*html*/ `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover">
    <title>通知车主挪车 - ` + plate + `</title>
    <style>
      :root { --sat: env(safe-area-inset-top, 0px); --sar: env(safe-area-inset-right, 0px); --sab: env(safe-area-inset-bottom, 0px); --sal: env(safe-area-inset-left, 0px); }
      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; margin: 0; padding: 0; }
      html { font-size: 16px; -webkit-text-size-adjust: 100%; }
      html, body { height: 100%; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif;
        background: linear-gradient(160deg, #0093E9 0%, #80D0C7 100%);
        min-height: 100vh; min-height: -webkit-fill-available;
        padding: clamp(16px, 4vw, 24px);
        padding-top: calc(clamp(16px, 4vw, 24px) + var(--sat));
        padding-bottom: calc(clamp(16px, 4vw, 24px) + var(--sab));
        padding-left: calc(clamp(16px, 4vw, 24px) + var(--sal));
        padding-right: calc(clamp(16px, 4vw, 24px) + var(--sar));
        display: flex; justify-content: center; align-items: flex-start;
      }
      body::before {
        content: ''; position: fixed; inset: 0;
        background: url("data:image/svg+xml,%3Csvg width='52' height='26' viewBox='0 0 52 26' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M10 10c0-2.21-1.79-4-4-4-3.314 0-6-2.686-6-6h2c0 2.21 1.79 4 4 4 3.314 0 6 2.686 6 6 0 2.21 1.79 4 4 4 3.314 0 6 2.686 6 6 0 2.21 1.79 4 4 4v2c-3.314 0-6-2.686-6-6 0-2.21-1.79-4-4-4-3.314 0-6-2.686-6-6zm25.464-1.95l8.486 8.486-1.414 1.414-8.486-8.486 1.414-1.414z' /%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
        z-index: -1;
      }
      .container { width: 100%; max-width: 500px; display: flex; flex-direction: column; gap: clamp(12px, 3vw, 20px); }
      .card { background: rgba(255, 255, 255, 0.95); border-radius: clamp(20px, 5vw, 28px); padding: clamp(18px, 4vw, 28px); box-shadow: 0 10px 40px rgba(0, 147, 233, 0.2); transition: transform 0.2s ease; }
      @media (hover: hover) { .card:hover { transform: translateY(-2px); } }
      .card:active { transform: scale(0.98); }
      .header { text-align: center; padding: clamp(20px, 5vw, 32px) clamp(16px, 4vw, 28px); background: white; }
      .icon-wrap { width: clamp(72px, 18vw, 100px); height: clamp(72px, 18vw, 100px); background: linear-gradient(135deg, #0093E9 0%, #80D0C7 100%); border-radius: clamp(22px, 5vw, 32px); display: flex; align-items: center; justify-content: center; margin: 0 auto clamp(14px, 3vw, 24px); box-shadow: 0 12px 32px rgba(0, 147, 233, 0.35); }
      .icon-wrap span { font-size: clamp(36px, 9vw, 52px); line-height: 1; display: block; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
      .header h1 { font-size: clamp(22px, 5.5vw, 30px); font-weight: 700; color: #1a202c; margin-bottom: 6px; }
      .header p { font-size: clamp(13px, 3.5vw, 16px); color: #718096; font-weight: 500; }
      .input-card { padding: 0; overflow: hidden; }
      .input-card .msg-input { width: 100%; min-height: clamp(90px, 20vw, 120px); border: none; padding: clamp(16px, 4vw, 24px); font-size: clamp(15px, 4vw, 18px); font-family: inherit; outline: none; color: #2d3748; background: transparent; line-height: 1.5; cursor: text; }
      .input-card .msg-input:empty::before { content: attr(data-placeholder); color: #a0aec0; pointer-events: none; }
      .tags { display: flex; justify-content: center; gap: clamp(8px, 3vw, 16px); padding: 0 clamp(12px, 3vw, 20px) clamp(14px, 3vw, 20px); flex-wrap: wrap; }
      .tag { background: linear-gradient(135deg, #e0f7fa 0%, #b2ebf2 100%); color: #00796b; padding: clamp(8px, 2vw, 12px) clamp(12px, 3vw, 18px); border-radius: 20px; font-size: clamp(13px, 3.5vw, 15px); font-weight: 600; white-space: nowrap; cursor: pointer; transition: all 0.2s; border: 1px solid #80cbc4; min-height: 44px; display: flex; align-items: center; }
      .tag:active { transform: scale(0.95); background: #80cbc4; }
      .tag.active { background: linear-gradient(135deg, #b2dfdb 0%, #80cbc4 100%); border-color: #00897b; color: #00695c; }
      .loc-card { display: flex; align-items: center; gap: clamp(10px, 3vw, 16px); padding: clamp(14px, 3.5vw, 22px) clamp(16px, 4vw, 24px); cursor: pointer; min-height: 64px; }
      .loc-icon { width: clamp(44px, 11vw, 56px); height: clamp(44px, 11vw, 56px); border-radius: clamp(14px, 3.5vw, 18px); display: flex; align-items: center; justify-content: center; font-size: clamp(22px, 5.5vw, 28px); transition: all 0.3s; flex-shrink: 0; }
      .loc-icon.loading { background: #fff3cd; }
      .loc-icon.success { background: #d4edda; }
      .loc-icon.error { background: #f8d7da; }
      .loc-content { flex: 1; min-width: 0; }
      .loc-title { font-size: clamp(15px, 4vw, 18px); font-weight: 600; color: #2d3748; }
      .loc-status { font-size: clamp(12px, 3.2vw, 14px); color: #718096; margin-top: 3px; }
      .loc-status.success { color: #28a745; }
      .loc-status.error { color: #dc3545; }
      .btn-main { background: linear-gradient(135deg, #0093E9 0%, #80D0C7 100%); color: white; border: none; padding: clamp(16px, 4vw, 22px); border-radius: clamp(16px, 4vw, 22px); font-size: clamp(16px, 4.2vw, 20px); font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; box-shadow: 0 10px 30px rgba(0, 147, 233, 0.35); transition: all 0.2s; min-height: 56px; }
      .btn-main:active { transform: scale(0.98); }
      .btn-main:disabled { background: linear-gradient(135deg, #94a3b8 0%, #64748b 100%); box-shadow: none; cursor: not-allowed; }
      .toast { position: fixed; top: calc(20px + var(--sat)); left: 50%; transform: translateX(-50%) translateY(-100px); background: white; padding: clamp(12px, 3vw, 16px) clamp(20px, 5vw, 32px); border-radius: 16px; font-size: clamp(14px, 3.5vw, 16px); font-weight: 600; color: #2d3748; box-shadow: 0 10px 40px rgba(0,0,0,0.15); opacity: 0; transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); z-index: 100; max-width: calc(100vw - 40px); }
      .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
      #successView { display: none; }
      .success-card { text-align: center; background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%); border: 2px solid #28a745; }
      .success-icon { font-size: clamp(56px, 14vw, 80px); margin-bottom: clamp(12px, 3vw, 20px); display: block; }
      .success-card h2 { color: #155724; margin-bottom: 8px; font-size: clamp(20px, 5vw, 28px); }
      .success-card p { color: #1e7e34; font-size: clamp(14px, 3.5vw, 16px); }
      .owner-card { background: white; border: 2px solid #80D0C7; text-align: center; }
      .owner-card.hidden { display: none; }
      .owner-card h3 { color: #0093E9; margin-bottom: 8px; font-size: clamp(18px, 4.5vw, 22px); }
      .owner-card p { color: #718096; margin-bottom: 16px; font-size: clamp(14px, 3.5vw, 16px); }
      .owner-card .map-links { display: flex; gap: clamp(8px, 2vw, 14px); flex-wrap: wrap; }
      .owner-card .map-btn { flex: 1; min-width: 120px; padding: clamp(12px, 3vw, 16px); border-radius: clamp(12px, 3vw, 16px); text-decoration: none; font-weight: 600; font-size: clamp(13px, 3.5vw, 15px); text-align: center; min-height: 48px; display: flex; align-items: center; justify-content: center; }
      .map-btn.amap { background: #1890ff; color: white; }
      .map-btn.apple { background: #1d1d1f; color: white; }
      .action-card { display: flex; flex-direction: column; gap: clamp(10px, 2.5vw, 14px); }
      .action-hint { text-align: center; font-size: clamp(13px, 3.5vw, 15px); color: #718096; margin-bottom: 4px; }
      .btn-retry, .btn-phone { color: white; border: none; padding: clamp(14px, 3.5vw, 18px); border-radius: clamp(14px, 3.5vw, 18px); font-size: clamp(15px, 4vw, 17px); font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s; min-height: 52px; text-decoration: none; }
      .btn-retry { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); box-shadow: 0 8px 24px rgba(245, 158, 11, 0.3); }
      .btn-phone { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); box-shadow: 0 8px 24px rgba(239, 68, 68, 0.3); }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      .loading-text { animation: pulse 1.5s ease-in-out infinite; }
      .modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 20px; opacity: 0; visibility: hidden; transition: all 0.3s; }
      .modal-overlay.show { opacity: 1; visibility: visible; }
      .modal-box { background: white; border-radius: 20px; padding: clamp(24px, 6vw, 32px); max-width: 340px; width: 100%; text-align: center; transform: scale(0.9); transition: transform 0.3s; }
      .modal-overlay.show .modal-box { transform: scale(1); }
      .modal-icon { font-size: 48px; margin-bottom: 16px; }
      .modal-title { font-size: 18px; font-weight: 700; color: #1a202c; margin-bottom: 8px; }
      .modal-desc { font-size: 14px; color: #718096; margin-bottom: 24px; line-height: 1.5; }
      .modal-buttons { display: flex; gap: 12px; }
      .modal-btn { flex: 1; padding: 14px 16px; border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s; }
      .modal-btn-primary { background: linear-gradient(135deg, #0093E9 0%, #80D0C7 100%); color: white; }
    </style>
  </head>
  <body>
    <div id="toast" class="toast"></div>

    <div id="locationTipModal" class="modal-overlay">
      <div class="modal-box">
        <div class="modal-icon">📍</div>
        <div class="modal-title">位置信息说明</div>
        <div class="modal-desc">分享位置可让车主确认您在车旁<br>不分享将延迟5分钟发送通知</div>
        <div class="modal-buttons">
          <button class="modal-btn modal-btn-primary" onclick="hideModal('locationTipModal');requestLocation()">我知道了</button>
        </div>
      </div>
    </div>

    <div class="container" id="mainView">
      <div class="card header">
        <div class="icon-wrap"><span>🚗</span></div>
        <h1>通知车主挪车</h1>
        <p>` + plate + `</p>
      </div>

      <div class="card input-card">
        <div id="msgInput" class="msg-input" contenteditable="true" data-placeholder="输入留言给车主...（或点击下方按钮）"></div>

        <div class="tags">
          <div id="tag-block" class="tag" onclick="selectBase('您的车挡住我了')">🚧 挡路</div>
          <div id="tag-temp"  class="tag" onclick="selectBase('临时停靠一下')">⏱️ 临停</div>
          <div id="tag-urgent" class="tag" onclick="toggleUrgent()">🙏 加急</div>
        </div>
      </div>

      <div class="card loc-card">
        <div id="locIcon" class="loc-icon loading">📍</div>
        <div class="loc-content">
          <div class="loc-title">我的位置</div>
          <div id="locStatus" class="loc-status">等待获取...</div>
        </div>
      </div>

      <button id="notifyBtn" class="card btn-main" onclick="sendNotify()">
        <span>🔔</span>
        <span>一键通知车主</span>
      </button>
    </div>

    <div class="container" id="successView">
      <div class="card success-card">
        <span class="success-icon">✅</span>
        <h2>通知已发送！</h2>
        <p id="waitingText" class="loading-text">正在等待车主回应...</p>
      </div>

      <div id="ownerFeedback" class="card owner-card hidden">
        <span style="font-size:56px; display:block; margin-bottom:16px">🎉</span>
        <h3>车主已收到通知</h3>
        <p>正在赶来，点击查看车主位置</p>
        <div id="ownerMapLinks" class="map-links" style="display:none">
          <a id="ownerAmapLink" href="#" class="map-btn amap">🗺️ 高德地图</a>
          <a id="ownerAppleLink" href="#" class="map-btn apple">🍎 Apple Maps</a>
        </div>
      </div>

      <div class="card action-card">
        <p class="action-hint">车主没反应？试试其他方式</p>
        <button id="retryBtn" class="btn-retry" onclick="retryNotify()">
          <span>🔔</span>
          <span>再次通知</span>
        </button>
        <a href="tel:` + phone + `" class="btn-phone">
          <span>📞</span>
          <span>直接拨号</span>
        </a>
      </div>
    </div>

    <script>
      (function() {
        let userLocation = null;
        let checkTimer = null;
        const vId = "` + vehicleId + `";

        window.onload = () => { showModal('locationTipModal'); };

        window.showModal = function(id) { document.getElementById(id).classList.add('show'); };
        window.hideModal = function(id) { document.getElementById(id).classList.remove('show'); };

        window.requestLocation = function() {
          const icon = document.getElementById('locIcon');
          const txt  = document.getElementById('locStatus');
          if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
              pos => {
                userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                icon.className = 'loc-icon success';
                txt.className  = 'loc-status success';
                txt.innerText  = '已获取位置 ✓';
              },
              () => {
                icon.className = 'loc-icon error';
                txt.innerText = '位置获取失败';
              },
              { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
          }
        };

        let selectedBaseText = '';
        let urgentInserted   = false;

        window.selectBase = function(text) {
          const el = document.getElementById('msgInput');
          if (selectedBaseText === text) {
            removeBaseText(el, text);
            selectedBaseText = '';
          } else {
            if (selectedBaseText) replaceBaseText(el, selectedBaseText, text);
            else insertAtCursor(el, text);
            selectedBaseText = text;
          }
          updateTagActive();
        };

        window.toggleUrgent = function() {
          const el = document.getElementById('msgInput');
          const existing = el.querySelector('span[data-urgent]');
          if (existing) {
            existing.remove();
            urgentInserted = false;
          } else {
            const u = document.createElement('span');
            u.dataset.urgent = '1';
            u.style.color = '#e53e3e';
            u.style.fontWeight = '700';
            u.textContent = '，麻烦尽快';
            el.appendChild(u);
            urgentInserted = true;
          }
          updateTagActive();
        };

        function insertAtCursor(el, text) {
          el.focus();
          const sel = window.getSelection();
          const urgentEl = el.querySelector('span[data-urgent]');
          if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode) && !(urgentEl && urgentEl.contains(sel.anchorNode))) {
            const range = sel.getRangeAt(0);
            range.deleteContents();
            const node = document.createTextNode(text);
            range.insertNode(node);
          } else {
            el.insertBefore(document.createTextNode(text), urgentEl || null);
          }
        }

        function removeBaseText(el, text) {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const n = walker.currentNode;
            if (n.parentNode.dataset && n.parentNode.dataset.urgent) continue;
            if (n.textContent.includes(text)) {
              n.textContent = n.textContent.replace(text, '');
              break;
            }
          }
        }

        function replaceBaseText(el, oldText, newText) {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let found = false;
          while (walker.nextNode()) {
            const n = walker.currentNode;
            if (n.parentNode.dataset && n.parentNode.dataset.urgent) continue;
            if (n.textContent.includes(oldText)) {
              n.textContent = n.textContent.replace(oldText, newText);
              found = true;
              break;
            }
          }
          if (!found) insertAtCursor(el, newText);
        }

        function updateTagActive() {
          document.getElementById('tag-block').classList.toggle('active', selectedBaseText === '您的车挡住我了');
          document.getElementById('tag-temp').classList.toggle('active',  selectedBaseText === '临时停靠一下');
          document.getElementById('tag-urgent').classList.toggle('active', urgentInserted);
        }

        window.sendNotify = async function() {
          const btn = document.getElementById('notifyBtn');
          const msg = document.getElementById('msgInput').innerText.trim();
          const delayed = !userLocation;
          btn.disabled = true;
          try {
            const res = await fetch("/api/v/" + vId + "/notify", {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: msg, location: userLocation, delayed })
            });
            if (res.ok) {
              document.getElementById('mainView').style.display = 'none';
              document.getElementById('successView').style.display = 'flex';
              startPolling();
            }
          } catch (e) { btn.disabled = false; }
        };

        function startPolling() {
          checkTimer = setInterval(async () => {
            try {
              const res = await fetch("/api/v/" + vId + "/check-status");
              const data = await res.json();
              if (data.status === 'confirmed') {
                document.getElementById('ownerFeedback').classList.remove('hidden');
                if (data.ownerLocation) {
                  document.getElementById('ownerMapLinks').style.display = 'flex';
                  document.getElementById('ownerAmapLink').href = data.ownerLocation.amapUrl;
                  document.getElementById('ownerAppleLink').href = data.ownerLocation.appleUrl;
                }
                clearInterval(checkTimer);
              }
            } catch(e) {}
          }, 3000);
        }

        window.retryNotify = async function() {
          await fetch("/api/v/" + vId + "/notify", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: '再次通知：请尽快挪车', location: userLocation })
          });
        };
      })();
    </script>
  </body>
  </html>
  `;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

function renderOwnerPage(vehicleId) {
  return `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover">
    <title>确认挪车</title>
    <style>
      :root { --sat: env(safe-area-inset-top, 0px); --sar: env(safe-area-inset-right, 0px); --sab: env(safe-area-inset-bottom, 0px); --sal: env(safe-area-inset-left, 0px); }
      * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif;
        background: linear-gradient(160deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh; min-height: -webkit-fill-available;
        padding: clamp(16px, 4vw, 24px);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
      }
      .card { background: rgba(255,255,255,0.95); padding: clamp(24px, 6vw, 36px); border-radius: clamp(24px, 6vw, 32px); text-align: center; width: 100%; max-width: 420px; box-shadow: 0 20px 60px rgba(102, 126, 234, 0.3); }
      .emoji { font-size: clamp(52px, 13vw, 72px); margin-bottom: clamp(16px, 4vw, 24px); display: block; }
      h1 { font-size: clamp(22px, 5.5vw, 28px); color: #2d3748; margin-bottom: 8px; }
      .subtitle { color: #718096; font-size: clamp(14px, 3.5vw, 16px); margin-bottom: clamp(20px, 5vw, 28px); }
      .map-section { background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%); border-radius: clamp(14px, 3.5vw, 18px); padding: clamp(14px, 3.5vw, 20px); margin-bottom: clamp(16px, 4vw, 24px); display: none; }
      .map-section.show { display: block; }
      .map-links { display: flex; gap: clamp(8px, 2vw, 12px); flex-wrap: wrap; }
      .map-btn { flex: 1; min-width: 110px; padding: clamp(12px, 3vw, 16px); border-radius: clamp(10px, 2.5vw, 14px); text-decoration: none; font-weight: 600; font-size: clamp(13px, 3.5vw, 15px); text-align: center; min-height: 48px; display: flex; align-items: center; justify-content: center; }
      .map-btn.amap { background: #1890ff; color: white; }
      .map-btn.apple { background: #1d1d1f; color: white; }
      .btn { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border: none; width: 100%; padding: clamp(16px, 4vw, 20px); border-radius: clamp(14px, 3.5vw, 18px); font-size: clamp(16px, 4.2vw, 19px); font-weight: 700; cursor: pointer; box-shadow: 0 8px 24px rgba(16, 185, 129, 0.35); display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 56px; }
      .done-msg { background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); border-radius: clamp(14px, 3.5vw, 18px); padding: clamp(16px, 4vw, 24px); margin-top: clamp(16px, 4vw, 24px); display: none; }
      .done-msg.show { display: block; }
    </style>
  </head>
  <body>
    <div class="card">
      <span class="emoji">👋</span>
      <h1>收到挪车请求</h1>
      <p class="subtitle">对方正在等待，请尽快确认</p>

      <div id="mapArea" class="map-section">
        <p>📍 对方位置</p>
        <div class="map-links">
          <a id="amapLink"  href="#" class="map-btn amap">🗺️ 高德地图</a>
          <a id="appleLink" href="#" class="map-btn apple">🍎 Apple Maps</a>
        </div>
      </div>

      <button id="confirmBtn" class="btn" onclick="confirmMove()">
        <span>🚀</span>
        <span>我已知晓，正在前往</span>
      </button>

      <div id="doneMsg" class="done-msg">
        <p>✅ 已通知对方您正在赶来！</p>
      </div>
    </div>

    <script>
      (function() {
        let ownerLocation = null;
        const vId = "` + vehicleId + `";
        window.onload = async () => {
          try {
            const res = await fetch('/api/get-location?v=' + vId);
            if (res.ok) {
              const data = await res.json();
              if (data.amapUrl) {
                document.getElementById('mapArea').classList.add('show');
                document.getElementById('amapLink').href  = data.amapUrl;
                document.getElementById('appleLink').href = data.appleUrl;
              }
            }
          } catch(e) {}
        };

        window.confirmMove = async function() {
          const btn = document.getElementById('confirmBtn');
          btn.disabled = true;
          if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
              async pos => { ownerLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude }; await doConfirm(); },
              async () => { ownerLocation = null; await doConfirm(); },
              { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
          } else { await doConfirm(); }
        };

        async function doConfirm() {
          try {
            await fetch('/api/owner-confirm?v=' + vId, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ location: ownerLocation })
            });
            document.getElementById('doneMsg').classList.add('show');
            document.getElementById('confirmBtn').style.display = 'none';
          } catch(e) {}
        }
      })();
    </script>
  </body>
  </html>
  `;
}
