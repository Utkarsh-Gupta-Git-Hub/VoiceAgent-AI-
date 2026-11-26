const API_BASE = "";

class ApiService {
  constructor() {
    this.token = localStorage.getItem("voice_agent_jwt");
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem("voice_agent_jwt", token);
    } else {
      localStorage.removeItem("voice_agent_jwt");
    }
  }

  getToken() {
    return this.token || localStorage.getItem("voice_agent_jwt");
  }

  async request(endpoint, options = {}) {
    const headers = options.headers || {};
    const token = this.getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    if (!(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    const config = {
      ...options,
      headers,
    };

    const response = await fetch(`${API_BASE}${endpoint}`, config);
    if (response.status === 401) {
      this.setToken(null);
      window.dispatchEvent(new CustomEvent("auth:required"));
      throw new Error("Session expired. Please log in again.");
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || `Request failed (${response.status})`);
    }

    if (response.status === 204) {
      return null;
    }

    return await response.json();
  }

  // Auth
  register(data) {
    return this.request("/api/auth/register", { method: "POST", body: JSON.stringify(data) });
  }

  login(data) {
    return this.request("/api/auth/login", { method: "POST", body: JSON.stringify(data) });
  }

  getMe() {
    return this.request("/api/auth/me");
  }

  // Dashboard Stats
  getStats() {
    return this.request("/api/contacts/dashboard/stats");
  }

  // Contacts
  getContacts(status = "ALL", search = "") {
    let q = "/api/contacts?";
    if (status && status !== "ALL") q += `status=${encodeURIComponent(status)}&`;
    if (search) q += `search=${encodeURIComponent(search)}&`;
    return this.request(q);
  }

  createContact(data) {
    return this.request("/api/contacts", { method: "POST", body: JSON.stringify(data) });
  }

  deleteContact(id) {
    return this.request(`/api/contacts/${id}`, { method: "DELETE" });
  }

  // Bookings
  getBookings() {
    return this.request("/api/demo-bookings");
  }

  // Calls
  getCalls() {
    return this.request("/api/calls");
  }

  getLiveKitToken(roomName = "", participantName = "") {
    let q = "/api/token?";
    if (roomName) q += `room_name=${encodeURIComponent(roomName)}&`;
    if (participantName) q += `participant_name=${encodeURIComponent(participantName)}&`;
    return this.request(q);
  }

  triggerOutboundCall(to, customField = "") {
    return this.request("/api/calls/outbound", {
      method: "POST",
      body: JSON.stringify({ to, customField }),
    });
  }

  // Campaigns
  getCampaigns() {
    return this.request("/api/campaigns");
  }

  uploadCampaign(formData) {
    return this.request("/api/campaigns/upload", {
      method: "POST",
      body: formData,
    });
  }

  startCampaign(id) {
    return this.request(`/api/campaigns/${id}/start`, { method: "POST" });
  }

  pauseCampaign(id) {
    return this.request(`/api/campaigns/${id}/pause`, { method: "POST" });
  }

  // Call Content (Scripts / Seasonal Prompts)
  getCallContents() {
    return this.request("/api/call-content");
  }

  getActiveCallContent() {
    return this.request("/api/call-content/active");
  }

  createCallContent(data) {
    return this.request("/api/call-content", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  updateCallContent(id, data) {
    return this.request(`/api/call-content/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  deleteCallContent(id) {
    return this.request(`/api/call-content/${id}`, { method: "DELETE" });
  }

  activateCallContent(id) {
    return this.request(`/api/call-content/${id}/activate`, { method: "POST" });
  }

  deactivateAllCallContent() {
    return this.request("/api/call-content/deactivate", { method: "POST" });
  }
}

export const api = new ApiService();
