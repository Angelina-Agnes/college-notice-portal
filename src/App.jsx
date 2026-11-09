import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import "./App.css";

const BUCKET = "college-documents";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const emptyNotice = { title: "", description: "", category: "General", file: null };
const emptyEvent = { title: "", description: "", location: "", event_date: "", end_date: "" };
const emptyAssessment = {
  title: "", description: "", subject: "", assessment_type: "Assignment", due_date: ""
};

function formatDate(value, includeTime = false) {
  if (!value) return "Not specified";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" });
}

function getExtension(name = "") {
  return name.split(".").pop().toLowerCase();
}

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState("home");
  const [message, setMessage] = useState("");
  const [notices, setNotices] = useState([]);
  const [events, setEvents] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [students, setStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState("");
  const [loginActivity, setLoginActivity] = useState([]);
  const [documentActivity, setDocumentActivity] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState("");
  const [chatText, setChatText] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ full_name: "", email: "", password: "" });
  const [noticeForm, setNoticeForm] = useState(emptyNotice);
  const [editingNotice, setEditingNotice] = useState(null);
  const [eventForm, setEventForm] = useState(emptyEvent);
  const [editingEvent, setEditingEvent] = useState(null);
  const [assessmentForm, setAssessmentForm] = useState(emptyAssessment);
  const [editingAssessment, setEditingAssessment] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      if (error) setMessage(error.message);
      setSession(data?.session ?? null);
      if (!data?.session) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!alive) return;
      setSession(nextSession);
      setProfile(null);
      setNotices([]);
      setEvents([]);
      setAssessments([]);
      setPreviewFile(null);
      setPreviewUrl("");
      setLoading(Boolean(nextSession));
      if (!nextSession) setLoading(false);
    });

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session?.user?.id) loadPortal();
    else {
      setProfile(null);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  useEffect(() => {
    if (profile?.role === "student") loadStudentChat();
    if (profile?.role === "admin") loadAdminData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.role]);

  useEffect(() => {
    if (profile?.role === "admin" && selectedStudent) {
      loadAdminChat(selectedStudent);
    } else if (profile?.role === "admin") {
      setMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.role, selectedStudent]);

  async function loadPortal() {
    setLoading(true);
    setMessage("");
    const { data: userProfile, error } = await supabase
      .from("profiles").select("*").eq("id", session.user.id).single();

    if (error) {
      setMessage("Could not load your profile: " + error.message);
      setLoading(false);
      return;
    }
    setProfile(userProfile);
    await Promise.all([loadNotices(), loadEvents(), loadAssessments()]);
    if (userProfile.role === "student") {
      await supabase.from("login_activity").insert({ student_id: session.user.id });
    }
    setLoading(false);
  }

  async function loadNotices() {
    const { data, error } = await supabase.from("notices").select("*")
      .order("created_at", { ascending: false });
    if (error) setMessage("Could not load notices: " + error.message);
    else setNotices(data || []);
  }

  async function loadEvents() {
    const { data, error } = await supabase.from("events").select("*")
      .order("event_date", { ascending: true });
    if (error) setMessage("Could not load events: " + error.message);
    else setEvents(data || []);
  }

  async function loadAssessments() {
    const { data, error } = await supabase.from("assessments").select("*")
      .order("due_date", { ascending: true });
    if (error) setMessage("Could not load assessments: " + error.message);
    else setAssessments(data || []);
  }

  async function loadAdminData() {
    setStudentsLoading(true);
    setStudentsError("");

    const [profilesResult, loginsResult, activityResult] = await Promise.all([
      supabase.from("profiles")
        .select("id, full_name, role")
        .eq("role", "student")
        .order("full_name", { ascending: true }),
      supabase.from("login_activity")
        .select("*")
        .order("logged_in_at", { ascending: false })
        .limit(200),
      supabase.from("document_activity")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300)
    ]);

    if (profilesResult.error) {
      setStudents([]);
      setStudentsError(
        "Unable to load the student list. Check the admin profiles SELECT policy. " +
        profilesResult.error.message
      );
    } else {
      const studentRows = profilesResult.data || [];
      setStudents(studentRows);
      setSelectedStudent(current =>
        current && studentRows.some(student => student.id === current)
          ? current
          : (studentRows[0]?.id || "")
      );
    }

    if (loginsResult.error) {
      setMessage("Could not load login history: " + loginsResult.error.message);
    } else {
      setLoginActivity(loginsResult.data || []);
    }

    if (activityResult.error) {
      setMessage("Could not load document activity: " + activityResult.error.message);
    } else {
      setDocumentActivity(activityResult.data || []);
    }

    setStudentsLoading(false);
  }

  async function loadStudentChat() {
    if (!session?.user?.id) return;
    const { data, error } = await supabase.from("chat_messages").select("*")
      .eq("student_id", session.user.id).order("created_at", { ascending: true });
    if (error) setMessage("Could not load chat: " + error.message);
    else setMessages(data || []);
  }

  async function loadAdminChat(studentId = selectedStudent) {
    if (!studentId) {
      setMessages([]);
      return;
    }

    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("student_id", studentId)
      .order("created_at", { ascending: true });

    if (error) {
      setMessages([]);
      setMessage("Could not load student chat: " + error.message);
    } else {
      setMessages(data || []);
    }
  }

  async function handleAuth(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (authMode === "register") {
        const { error } = await supabase.auth.signUp({
          email: authForm.email,
          password: authForm.password,
          options: { data: { full_name: authForm.full_name } }
        });
        if (error) throw error;
        setMessage("Registration submitted. If email confirmation is enabled, confirm your email before logging in.");
        setAuthMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: authForm.email, password: authForm.password
        });
        if (error) throw error;
      }
    } catch (error) {
      setMessage(error.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    setPage("home");
    setMessages([]);
  }

  async function uploadFile(file, folder = "documents") {
    if (!file) return null;
    if (file.size > MAX_FILE_SIZE) throw new Error("Please select a file smaller than 10 MB.");
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${folder}/${session.user.id}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false
    });
    if (error) throw error;
    return path;
  }

  async function saveNotice(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    let uploadedPath = null;
    try {
      let filePath = editingNotice?.file_path || null;
      let fileName = editingNotice?.file_name || null;
      if (noticeForm.file) {
        uploadedPath = await uploadFile(noticeForm.file, "notices");
        filePath = uploadedPath;
        fileName = noticeForm.file.name;
      }
      const values = {
        title: noticeForm.title.trim(),
        description: noticeForm.description.trim(),
        category: noticeForm.category,
        file_path: filePath,
        file_name: fileName,
        published: true,
        created_by: session.user.id
      };
      const result = editingNotice
        ? await supabase.from("notices").update(values).eq("id", editingNotice.id)
        : await supabase.from("notices").insert(values);
      if (result.error) throw result.error;
      if (editingNotice && uploadedPath && editingNotice.file_path) {
        await supabase.storage.from(BUCKET).remove([editingNotice.file_path]);
      }
      setNoticeForm(emptyNotice);
      setEditingNotice(null);
      setMessage(editingNotice ? "Notice updated successfully." : "Notice published successfully.");
      await loadNotices();
    } catch (error) {
      if (uploadedPath) await supabase.storage.from(BUCKET).remove([uploadedPath]);
      setMessage(error.message || "Unable to save notice.");
    } finally {
      setBusy(false);
    }
  }

  function startEditNotice(notice) {
    setEditingNotice(notice);
    setNoticeForm({
      title: notice.title || "",
      description: notice.description || "",
      category: notice.category || "General",
      file: null
    });
    setPage("manage-notices");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteNotice(notice) {
    if (!window.confirm(`Delete "${notice.title}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("notices").delete().eq("id", notice.id);
    if (error) setMessage(error.message);
    else {
      if (notice.file_path) await supabase.storage.from(BUCKET).remove([notice.file_path]);
      setMessage("Notice deleted.");
      await loadNotices();
    }
  }

  async function saveEvent(event) {
    event.preventDefault();
    setBusy(true);
    const values = {
      title: eventForm.title.trim(),
      description: eventForm.description.trim(),
      location: eventForm.location.trim(),
      event_date: new Date(eventForm.event_date).toISOString(),
      end_date: eventForm.end_date ? new Date(eventForm.end_date).toISOString() : null,
      created_by: session.user.id
    };
    const result = editingEvent
      ? await supabase.from("events").update(values).eq("id", editingEvent.id)
      : await supabase.from("events").insert(values);
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else {
      setMessage(editingEvent ? "Event updated." : "Event created.");
      setEventForm(emptyEvent);
      setEditingEvent(null);
      await loadEvents();
    }
  }

  async function deleteEvent(item) {
    if (!window.confirm(`Delete event "${item.title}"?`)) return;
    const { error } = await supabase.from("events").delete().eq("id", item.id);
    if (error) setMessage(error.message);
    else { setMessage("Event deleted."); await loadEvents(); }
  }

  async function saveAssessment(event) {
    event.preventDefault();
    setBusy(true);
    const values = {
      title: assessmentForm.title.trim(),
      description: assessmentForm.description.trim(),
      subject: assessmentForm.subject.trim(),
      assessment_type: assessmentForm.assessment_type,
      due_date: new Date(assessmentForm.due_date).toISOString(),
      created_by: session.user.id
    };
    const result = editingAssessment
      ? await supabase.from("assessments").update(values).eq("id", editingAssessment.id)
      : await supabase.from("assessments").insert(values);
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else {
      setMessage(editingAssessment ? "Assessment updated." : "Assessment created.");
      setAssessmentForm(emptyAssessment);
      setEditingAssessment(null);
      await loadAssessments();
    }
  }

  async function deleteAssessment(item) {
    if (!window.confirm(`Delete "${item.title}"?`)) return;
    const { error } = await supabase.from("assessments").delete().eq("id", item.id);
    if (error) setMessage(error.message);
    else { setMessage("Assessment deleted."); await loadAssessments(); }
  }

  async function recordDocumentActivity(notice, action) {
    if (profile?.role !== "student") return;
    const { error } = await supabase.from("document_activity").insert({
      notice_id: notice.id,
      student_id: session.user.id,
      action
    });
    if (error) console.error("Document activity could not be recorded:", error.message);
  }

  async function viewDocument(notice) {
    if (!notice.file_path) {
      setMessage("There is no file attached to this notice.");
      return;
    }
    setPreviewLoading(true);
    setPreviewFile(notice);
    setPreviewUrl("");
    setMessage("");
    try {
      const { data, error } = await supabase.storage.from(BUCKET)
        .createSignedUrl(notice.file_path, 900);
      if (error) throw error;
      setPreviewUrl(data.signedUrl);
      await recordDocumentActivity(notice, "view");
    } catch (error) {
      setMessage("Unable to preview this file: " + error.message);
      setPreviewFile(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function downloadDocument(notice) {
    if (!notice.file_path) {
      setMessage("There is no file attached to this notice.");
      return;
    }
    try {
      const { data, error } = await supabase.storage.from(BUCKET)
        .createSignedUrl(notice.file_path, 900, { download: notice.file_name || true });
      if (error) throw error;
      await recordDocumentActivity(notice, "download");
      const link = document.createElement("a");
      link.href = data.signedUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.download = notice.file_name || "";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      setMessage("Unable to download this file: " + error.message);
    }
  }

  function closePreview() {
    setPreviewFile(null);
    setPreviewUrl("");
    setPreviewLoading(false);
  }

  function renderDocumentPreview() {
    if (previewLoading) return <div className="preview-placeholder">Loading document preview…</div>;
    if (!previewFile || !previewUrl) return null;
    const ext = getExtension(previewFile.file_name);
    const imageTypes = ["jpg", "jpeg", "png", "gif", "webp", "bmp"];
    if (imageTypes.includes(ext)) {
      return <img className="image-preview" src={previewUrl} alt={previewFile.file_name} />;
    }
    if (ext === "pdf") {
      return <iframe className="document-frame" src={previewUrl} title={previewFile.file_name} />;
    }
    if (["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) {
      const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(previewUrl)}`;
      return <iframe className="document-frame" src={officeUrl} title={previewFile.file_name} allowFullScreen />;
    }
    if (["txt", "html", "htm"].includes(ext)) {
      return <iframe className="document-frame" src={previewUrl} title={previewFile.file_name} sandbox="" />;
    }
    return (
      <div className="preview-placeholder">
        <h3>Preview is not supported for this file type</h3>
        <p>Use Download to open this file with an application on your device.</p>
      </div>
    );
  }

  async function sendChat(event) {
    event.preventDefault();
    const text = chatText.trim();
    const studentId = profile.role === "student" ? session.user.id : selectedStudent;
    if (!text || !studentId) return;
    const { error } = await supabase.from("chat_messages").insert({
      student_id: studentId,
      sender_id: session.user.id,
      message: text
    });
    if (error) setMessage("Message could not be sent: " + error.message);
    else {
      setChatText("");
      if (profile.role === "student") await loadStudentChat();
      else await loadAdminChat();
    }
  }

  const upcomingEvents = useMemo(() => events.filter(x => new Date(x.event_date) >= new Date()), [events]);
  const upcomingAssessments = useMemo(() => assessments.filter(x => new Date(x.due_date) >= new Date()), [assessments]);
  const isAdmin = profile?.role === "admin";
  const visibleNotices = isAdmin ? notices : notices.filter(x => x.published);

  if (loading) return <div className="full-loading">Loading your university portal…</div>;

  if (!session) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="brand-mark">U</div>
          <p className="eyebrow">UNIVERSITY CONNECT</p>
          <h1>{authMode === "login" ? "Welcome back" : "Create your account"}</h1>
          <p className="muted">Notices, resources, events and student support in one place.</p>
          <form onSubmit={handleAuth}>
            {authMode === "register" && (
              <label>Full name
                <input required value={authForm.full_name} onChange={e => setAuthForm({ ...authForm, full_name: e.target.value })} />
              </label>
            )}
            <label>Email address
              <input type="email" required value={authForm.email} onChange={e => setAuthForm({ ...authForm, email: e.target.value })} />
            </label>
            <label>Password
              <input type="password" required minLength="6" value={authForm.password} onChange={e => setAuthForm({ ...authForm, password: e.target.value })} />
            </label>
            <button className="primary-btn full-btn" disabled={busy}>{busy ? "Please wait…" : authMode === "login" ? "Sign in" : "Register"}</button>
          </form>
          <button className="link-btn" onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setMessage(""); }}>
            {authMode === "login" ? "New student? Create an account" : "Already registered? Sign in"}
          </button>
          {message && <p className="status-message">{message}</p>}
        </div>
      </div>
    );
  }

  if (!profile) return <div className="full-loading">Preparing your dashboard… {message}</div>;

  const studentNav = [
    ["home", "⌂", "Home"], ["notices", "▤", "News & Notices"],
    ["events", "▦", "Events"], ["assessments", "✓", "Assessments"],
    ["resources", "▣", "Resources"], ["chat", "✉", "Student Chat"]
  ];
  const adminNav = [
    ["home", "⌂", "Dashboard"], ["manage-notices", "▤", "Manage Notices"],
    ["manage-events", "▦", "Manage Events"], ["manage-assessments", "✓", "Assessments"],
    ["activity", "◷", "Student Activity"], ["chat", "✉", "Student Chats"]
  ];
  const navItems = isAdmin ? adminNav : studentNav;

  return (
    <div className="portal-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><span className="brand-mark small">U</span><div><strong>University</strong><small>CONNECT PORTAL</small></div></div>
        <div className="user-mini"><div className="avatar">{(profile.full_name || profile.email || "U").charAt(0).toUpperCase()}</div><div><strong>{profile.full_name || "Portal User"}</strong><small>{isAdmin ? "Administrator" : "Student"}</small></div></div>
        <nav>
          {navItems.map(([key, icon, label]) => (
            <button key={key} className={`nav-link ${page === key ? "active" : ""}`} onClick={() => { setPage(key); setMessage(""); }}>
              <span>{icon}</span>{label}
            </button>
          ))}
        </nav>
        <button className="logout-btn" onClick={logout}>↪ Sign out</button>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div><span className="eyebrow">UNIVERSITY CONNECT</span><h2>{page === "home" ? (isAdmin ? "Admin dashboard" : "Student dashboard") : navItems.find(x => x[0] === page)?.[2] || "Dashboard"}</h2></div>
          <div className="topbar-user"><span>{profile.full_name || profile.email}</span><div className="avatar">{(profile.full_name || profile.email || "U").charAt(0).toUpperCase()}</div></div>
        </header>

        {message && <div className="alert-message"><span>{message}</span><button onClick={() => setMessage("")}>×</button></div>}

        {page === "home" && (
          <>
            <section className="welcome-banner">
              <div><p className="eyebrow light">{isAdmin ? "ADMINISTRATION" : "YOUR CAMPUS, CONNECTED"}</p><h1>{isAdmin ? `Welcome, ${profile.full_name || "Administrator"}` : `Welcome back, ${profile.full_name || "Student"}!`}</h1><p>{isAdmin ? "Manage campus information and support your students." : "Stay updated with campus news, upcoming events and important deadlines."}</p></div>
              <div className="banner-symbol">✦</div>
            </section>
            <section className="stat-grid">
              <div className="stat-card"><span className="stat-icon blue">▤</span><div><strong>{notices.length}</strong><small>{isAdmin ? "Total notices" : "Announcements"}</small></div></div>
              <div className="stat-card"><span className="stat-icon purple">▦</span><div><strong>{upcomingEvents.length}</strong><small>Upcoming events</small></div></div>
              <div className="stat-card"><span className="stat-icon orange">✓</span><div><strong>{upcomingAssessments.length}</strong><small>Upcoming assessments</small></div></div>
              {isAdmin && <div className="stat-card"><span className="stat-icon green">♙</span><div><strong>{students.length}</strong><small>Registered students</small></div></div>}
            </section>
            <div className="content-grid">
              <section className="panel"><div className="section-heading"><div><h3>Latest university news</h3><p>Recent notices and announcements</p></div><button className="text-btn" onClick={() => setPage(isAdmin ? "manage-notices" : "notices")}>View all</button></div>
                {visibleNotices.slice(0, 4).map(item => <NoticeRow key={item.id} item={item} onView={viewDocument} onDownload={downloadDocument} />)}
                {!visibleNotices.length && <Empty text="No announcements have been published yet." />}
              </section>
              <section className="panel"><div className="section-heading"><div><h3>Upcoming events</h3><p>What is happening on campus</p></div><button className="text-btn" onClick={() => setPage(isAdmin ? "manage-events" : "events")}>View all</button></div>
                {upcomingEvents.slice(0, 4).map(item => <EventRow key={item.id} item={item} />)}
                {!upcomingEvents.length && <Empty text="No upcoming events." />}
              </section>
              <section className="panel wide-panel"><div className="section-heading"><div><h3>Upcoming assessments & reminders</h3><p>Keep track of important academic deadlines</p></div><button className="text-btn" onClick={() => setPage(isAdmin ? "manage-assessments" : "assessments")}>View all</button></div>
                {upcomingAssessments.slice(0, 5).map(item => <AssessmentRow key={item.id} item={item} />)}
                {!upcomingAssessments.length && <Empty text="No upcoming assessments." />}
              </section>
              {isAdmin && <section className="panel"><div className="section-heading"><div><h3>Quick actions</h3><p>Update your campus portal</p></div></div><div className="quick-actions"><button onClick={() => setPage("manage-notices")}>＋ Create notice</button><button onClick={() => setPage("manage-events")}>＋ Add event</button><button onClick={() => setPage("manage-assessments")}>＋ Add assessment</button></div></section>}
            </div>
          </>
        )}

        {(page === "notices" || page === "resources") && !isAdmin && (
          <section className="panel page-panel"><div className="section-heading"><div><h3>{page === "resources" ? "Learning resources" : "News & announcements"}</h3><p>Open a document to view it here, or download a copy.</p></div></div>
            {visibleNotices.map(item => <NoticeRow key={item.id} item={item} onView={viewDocument} onDownload={downloadDocument} />)}
            {!visibleNotices.length && <Empty text="No notices or resources available." />}
          </section>
        )}

        {page === "events" && !isAdmin && <section className="panel page-panel"><h3>Upcoming campus events</h3>{upcomingEvents.map(item => <EventRow key={item.id} item={item} />)}{!upcomingEvents.length && <Empty text="No upcoming events." />}</section>}
        {page === "assessments" && !isAdmin && <section className="panel page-panel"><h3>Assessments & deadlines</h3>{upcomingAssessments.map(item => <AssessmentRow key={item.id} item={item} />)}{!upcomingAssessments.length && <Empty text="No upcoming assessments." />}</section>}

        {page === "manage-notices" && isAdmin && (
          <div className="management-layout">
            <section className="panel form-panel"><h3>{editingNotice ? "Update notice" : "Create a notice"}</h3><p className="muted">Publish announcements and attach documents.</p>
              <form onSubmit={saveNotice}>
                <label>Notice title<input required value={noticeForm.title} onChange={e => setNoticeForm({ ...noticeForm, title: e.target.value })} /></label>
                <label>Description<textarea rows="4" value={noticeForm.description} onChange={e => setNoticeForm({ ...noticeForm, description: e.target.value })} /></label>
                <label>Category<select value={noticeForm.category} onChange={e => setNoticeForm({ ...noticeForm, category: e.target.value })}><option>General</option><option>Assignment</option><option>Examination</option><option>Events</option><option>Study Material</option><option>University News</option></select></label>
                <label>Attach file (maximum 10 MB)<input type="file" onChange={e => setNoticeForm({ ...noticeForm, file: e.target.files?.[0] || null })} /></label>
                {editingNotice?.file_name && <p className="muted">Current file: {editingNotice.file_name}. Select another file to replace it.</p>}
                <div className="form-actions"><button className="primary-btn" disabled={busy}>{busy ? "Saving…" : editingNotice ? "Save changes" : "Publish notice"}</button>{editingNotice && <button type="button" className="secondary-btn" onClick={() => { setEditingNotice(null); setNoticeForm(emptyNotice); }}>Cancel edit</button>}</div>
              </form>
            </section>
            <section className="panel"><h3>All notices</h3>{notices.map(item => <div className="manage-row" key={item.id}><div><strong>{item.title}</strong><small>{item.category} · {formatDate(item.created_at)}</small></div><div className="row-actions"><button onClick={() => startEditNotice(item)}>Edit</button><button className="danger-text" onClick={() => deleteNotice(item)}>Delete</button></div></div>)}{!notices.length && <Empty text="No notices created." />}</section>
          </div>
        )}

        {page === "manage-events" && isAdmin && (
          <div className="management-layout">
            <section className="panel form-panel"><h3>{editingEvent ? "Update event" : "Create campus event"}</h3><form onSubmit={saveEvent}>
              <label>Event title<input required value={eventForm.title} onChange={e => setEventForm({ ...eventForm, title: e.target.value })} /></label>
              <label>Description<textarea rows="3" value={eventForm.description} onChange={e => setEventForm({ ...eventForm, description: e.target.value })} /></label>
              <label>Location<input value={eventForm.location} onChange={e => setEventForm({ ...eventForm, location: e.target.value })} /></label>
              <label>Start date and time<input type="datetime-local" required value={eventForm.event_date} onChange={e => setEventForm({ ...eventForm, event_date: e.target.value })} /></label>
              <label>End date and time<input type="datetime-local" value={eventForm.end_date} onChange={e => setEventForm({ ...eventForm, end_date: e.target.value })} /></label>
              <div className="form-actions"><button className="primary-btn" disabled={busy}>{editingEvent ? "Update event" : "Create event"}</button>{editingEvent && <button type="button" className="secondary-btn" onClick={() => { setEditingEvent(null); setEventForm(emptyEvent); }}>Cancel</button>}</div>
            </form></section>
            <section className="panel"><h3>Manage events</h3>{events.map(item => <div className="manage-row" key={item.id}><div><strong>{item.title}</strong><small>{formatDate(item.event_date, true)} · {item.location}</small></div><div className="row-actions"><button onClick={() => { setEditingEvent(item); setEventForm({ title: item.title, description: item.description || "", location: item.location || "", event_date: item.event_date?.slice(0, 16) || "", end_date: item.end_date?.slice(0, 16) || "" }); }}>Edit</button><button className="danger-text" onClick={() => deleteEvent(item)}>Delete</button></div></div>)}{!events.length && <Empty text="No events created." />}</section>
          </div>
        )}

        {page === "manage-assessments" && isAdmin && (
          <div className="management-layout">
            <section className="panel form-panel"><h3>{editingAssessment ? "Update assessment" : "Create assessment"}</h3><form onSubmit={saveAssessment}>
              <label>Assessment title<input required value={assessmentForm.title} onChange={e => setAssessmentForm({ ...assessmentForm, title: e.target.value })} /></label>
              <label>Subject<input value={assessmentForm.subject} onChange={e => setAssessmentForm({ ...assessmentForm, subject: e.target.value })} /></label>
              <label>Type<select value={assessmentForm.assessment_type} onChange={e => setAssessmentForm({ ...assessmentForm, assessment_type: e.target.value })}><option>Assignment</option><option>Internal Assessment</option><option>Project</option><option>Quiz</option><option>Examination</option><option>Lab</option></select></label>
              <label>Description<textarea rows="3" value={assessmentForm.description} onChange={e => setAssessmentForm({ ...assessmentForm, description: e.target.value })} /></label>
              <label>Due date and time<input type="datetime-local" required value={assessmentForm.due_date} onChange={e => setAssessmentForm({ ...assessmentForm, due_date: e.target.value })} /></label>
              <div className="form-actions"><button className="primary-btn" disabled={busy}>{editingAssessment ? "Update assessment" : "Create assessment"}</button>{editingAssessment && <button type="button" className="secondary-btn" onClick={() => { setEditingAssessment(null); setAssessmentForm(emptyAssessment); }}>Cancel</button>}</div>
            </form></section>
            <section className="panel"><h3>Manage assessments</h3>{assessments.map(item => <div className="manage-row" key={item.id}><div><strong>{item.title}</strong><small>{item.assessment_type} · {formatDate(item.due_date, true)}</small></div><div className="row-actions"><button onClick={() => { setEditingAssessment(item); setAssessmentForm({ title: item.title, description: item.description || "", subject: item.subject || "", assessment_type: item.assessment_type || "Assignment", due_date: item.due_date?.slice(0, 16) || "" }); }}>Edit</button><button className="danger-text" onClick={() => deleteAssessment(item)}>Delete</button></div></div>)}{!assessments.length && <Empty text="No assessments created." />}</section>
          </div>
        )}

        {page === "activity" && isAdmin && (
          <div className="activity-grid">
            <section className="panel"><h3>Student login history</h3><p className="muted">Latest recorded student sign-ins · student names are shown instead of email addresses</p><div className="table-wrap"><table><thead><tr><th>Student name</th><th>Login time</th></tr></thead><tbody>
              {loginActivity.map(log => {
                const student = students.find(s => s.id === log.student_id);
                return <tr key={log.id}><td className="student-name-cell">{student?.full_name?.trim() || "Student name not available"}</td><td>{formatDate(log.logged_in_at, true)}</td></tr>;
              })}
            </tbody></table></div>{!loginActivity.length && <Empty text="No login records yet." />}</section>
            <section className="panel"><h3>Document views and downloads</h3><p className="muted">Student document activity</p><div className="table-wrap"><table><thead><tr><th>Student name</th><th>Notice</th><th>Action</th><th>Time</th></tr></thead><tbody>
              {documentActivity.map(log => {
                const student = students.find(s => s.id === log.student_id);
                const notice = notices.find(n => n.id === log.notice_id);
                return <tr key={log.id}><td className="student-name-cell">{student?.full_name?.trim() || "Student name not available"}</td><td>{notice?.title || `Notice #${log.notice_id}`}</td><td><span className={`activity-pill ${log.action}`}>{log.action}</span></td><td>{formatDate(log.created_at, true)}</td></tr>;
              })}
            </tbody></table></div>{!documentActivity.length && <Empty text="No document activity yet." />}</section>
          </div>
        )}

        {page === "chat" && (
          <section className="panel chat-panel">
            <div className="section-heading"><div><h3>{isAdmin ? "Student support conversations" : "Student help desk"}</h3><p>{isAdmin ? "Choose a student to view and respond to their messages." : "Ask questions or send doubts to the administration."}</p></div></div>
            {isAdmin && (
              <div className="chat-student-picker">
                <label className="student-select">Select student
                  <select
                    value={selectedStudent}
                    onChange={e => {
                      setSelectedStudent(e.target.value);
                      setChatText("");
                    }}
                    disabled={studentsLoading || students.length === 0}
                  >
                    <option value="">
                      {studentsLoading ? "Loading students…" : students.length ? "Choose a student" : "No students available"}
                    </option>
                    {students.map(student => (
                      <option key={student.id} value={student.id}>
                        {student.full_name?.trim() || "Name not provided"}
                      </option>
                    ))}
                  </select>
                </label>
                {studentsError && <p className="student-list-error">{studentsError}</p>}
                {!studentsLoading && !studentsError && students.length === 0 && (
                  <p className="student-list-error">No student profiles are visible to this admin account. Apply the SQL policy shown below.</p>
                )}
              </div>
            )}
            <div className="chat-messages">
              {messages.map(msg => <div key={msg.id} className={`chat-bubble ${msg.sender_id === session.user.id ? "mine" : "theirs"}`}><p>{msg.message}</p><small>{msg.sender_id === session.user.id ? "You (Admin)" : isAdmin ? (students.find(s => s.id === selectedStudent)?.full_name || "Student") : "Administrator"} · {formatDate(msg.created_at, true)}</small></div>)}
              {!messages.length && <Empty text={isAdmin && !selectedStudent ? "Select a student to open a conversation." : "No messages yet. Start the conversation below."} />}
            </div>
            <form className="chat-compose" onSubmit={sendChat}><input placeholder="Type your message…" value={chatText} onChange={e => setChatText(e.target.value)} disabled={isAdmin && !selectedStudent} /><button className="primary-btn" disabled={!chatText.trim() || (isAdmin && !selectedStudent)}>Send</button></form>
          </section>
        )}

        {previewFile && (
          <section className="panel preview-panel">
            <div className="section-heading"><div><h3>Document viewer</h3><p>{previewFile.file_name}</p></div><div className="preview-actions"><button className="secondary-btn" onClick={() => downloadDocument(previewFile)}>Download</button><button className="close-btn" onClick={closePreview}>Close viewer ×</button></div></div>
            <div className="preview-content">{renderDocumentPreview()}</div>
            {["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(getExtension(previewFile.file_name)) && <p className="viewer-note">Office previews are provided by Microsoft Office Online and require the signed file link to be reachable from the internet. If the preview service cannot open it, use Download.</p>}
          </section>
        )}

        <footer className="portal-footer">University Connect · Student and Administration Portal</footer>
      </main>
    </div>
  );
}

function Empty({ text }) {
  return <div className="empty-state">{text}</div>;
}

function NoticeRow({ item, onView, onDownload }) {
  return (
    <article className="notice-row">
      <div className="file-icon">▤</div>
      <div className="notice-info"><span className="category-tag">{item.category || "General"}</span><strong>{item.title}</strong><p>{item.description || "No additional description."}</p><small>{formatDate(item.created_at)}</small></div>
      {item.file_path && <div className="notice-buttons"><button className="view-btn" onClick={() => onView(item)}>View</button><button className="download-btn" onClick={() => onDownload(item)}>Download</button></div>}
    </article>
  );
}

function EventRow({ item }) {
  const date = new Date(item.event_date);
  return (
    <article className="event-row"><div className="date-tile"><strong>{Number.isNaN(date.getTime()) ? "—" : date.getDate()}</strong><small>{Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { month: "short" })}</small></div><div><strong>{item.title}</strong><p>{item.description || item.location || "University event"}</p><small>{formatDate(item.event_date, true)}{item.location ? ` · ${item.location}` : ""}</small></div></article>
  );
}

function AssessmentRow({ item }) {
  return <article className="assessment-row"><div className="assessment-check">✓</div><div><strong>{item.title}</strong><p>{[item.subject, item.assessment_type].filter(Boolean).join(" · ")}</p><small>Due: {formatDate(item.due_date, true)}</small></div></article>;
}

export default App;
