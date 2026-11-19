
import { auth, db } from "./firebase-config.js";
import { requireRole } from "./session.js";
import { notifySectionStudents } from "./notification-service.js";

import {
    collection,
    doc,
    getDocs,
    query,
    where,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const contentList = $("contentList");
const messageBox = $("message");

const pendingCount = $("pendingCount");
const approvedCount = $("approvedCount");
const assignedCount = $("assignedCount");

let currentTeacher = null;
let teacherSections = [];
let allContent = [];
let activeFilter = "all";

/* =====================================================
   HELPERS
===================================================== */

function showMessage(message, type = "success") {
    messageBox.textContent = message;
    messageBox.className = `show ${type}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

function normalizeStatus(item) {
    const value = String(item.reviewStatus || item.status || "pending")
        .toLowerCase()
        .trim();

    if (["pending_review", "pending"].includes(value)) return "pending";
    if (["approved"].includes(value)) return "approved";
    if (["rejected"].includes(value)) return "rejected";

    return value;
}

function getStatus(item) {
    return normalizeStatus(item);
}

function isAssignedToTeacher(item) {
    return item.assignedTeacherId === currentTeacher?.uid
        && item.status === "active"
        && getStatus(item) === "approved";
}

function getCollectionName(item) {
    return item.type === "module" ? "modules" : "lessons";
}

function safeUrl(value) {
    if (!value) return "";

    try {
        const url = new URL(String(value), window.location.href);

        if (!["http:", "https:", "blob:"].includes(url.protocol)) {
            return "";
        }

        return url.href;
    } catch {
        return "";
    }
}

/* =====================================================
   SUMMARY
===================================================== */

function updateSummary() {
    const pending = allContent.filter(item =>
        getStatus(item) === "pending"
    ).length;

    const approved = allContent.filter(item =>
        getStatus(item) === "approved" &&
        !isAssignedToTeacher(item)
    ).length;

    const assigned = allContent.filter(isAssignedToTeacher).length;

    pendingCount.textContent = pending;
    approvedCount.textContent = approved;
    assignedCount.textContent = assigned;
}

/* =====================================================
   TEACHER SECTIONS
===================================================== */

async function loadTeacherSections() {
    const sectionsRef = collection(db, "sections");

    const [multipleTeacherResult, singleTeacherResult] =
        await Promise.all([
            getDocs(query(
                sectionsRef,
                where("teacherIds", "array-contains", currentTeacher.uid)
            )),
            getDocs(query(
                sectionsRef,
                where("teacherId", "==", currentTeacher.uid)
            ))
        ]);

    const sectionMap = new Map();

    [...multipleTeacherResult.docs, ...singleTeacherResult.docs]
        .forEach(sectionDoc => {
            const data = sectionDoc.data();

            sectionMap.set(sectionDoc.id, {
                id: sectionDoc.id,
                name: data.sectionName
                    || data.name
                    || data.section
                    || sectionDoc.id,
                course: data.course || "",
                yearLevel: data.yearLevel || ""
            });
        });

    teacherSections = [...sectionMap.values()];
}

/* =====================================================
   LOAD ADMIN CONTENT
===================================================== */

async function loadAdminContent() {
    contentList.innerHTML = `
        <div class="empty">Loading Admin content...</div>
    `;

    const modulesQuery = query(
        collection(db, "modules"),
        where("createdByRole", "==", "admin"),
        where("reviewStatus", "in", ["pending", "approved"])
    );

    const lessonsQuery = query(
        collection(db, "lessons"),
        where("createdByRole", "==", "admin"),
        where("reviewStatus", "in", ["pending", "approved"])
    );

    const [modulesSnapshot, lessonsSnapshot] = await Promise.all([
        getDocs(modulesQuery),
        getDocs(lessonsQuery)
    ]);

    const modules = modulesSnapshot.docs.map(snapshot => ({
        id: snapshot.id,
        type: "module",
        ...snapshot.data()
    }));

    const lessons = lessonsSnapshot.docs.map(snapshot => ({
        id: snapshot.id,
        type: "lesson",
        ...snapshot.data()
    }));

    allContent = [...modules, ...lessons].sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return bTime - aTime;
    });

    updateSummary();
    renderContent();
}

/* =====================================================
   SECTION SELECTOR
===================================================== */

function sectionOptions(item) {
    if (!teacherSections.length) {
        return `<option value="">No assigned sections found</option>`;
    }

    const selectedSection = item.sectionIds?.[0] || "";

    return `
        <option value="">Select your section</option>
        ${teacherSections.map(section => `
            <option value="${escapeHTML(section.id)}"
                ${selectedSection === section.id ? "selected" : ""}>
                ${escapeHTML(section.name)}
                ${section.course ? " — " + escapeHTML(section.course) : ""}
                ${section.yearLevel ? " — " + escapeHTML(section.yearLevel) : ""}
            </option>
        `).join("")}
    `;
}

/* =====================================================
   ATTACHMENTS AND RESOURCES
===================================================== */

function renderAttachments(item) {
    const attachments = Array.isArray(item.attachments)
        ? item.attachments
        : [];

    const resources = Array.isArray(item.resourceLinks)
        ? item.resourceLinks
        : [];

    const legacyFile = item.fileUrl
        ? [{
            fileUrl: item.fileUrl,
            fileName: item.fileName || "Open attachment"
        }]
        : [];

    const files = [...attachments, ...legacyFile];
    const links = [];

    const videoUrl = safeUrl(item.videoUrl);

    if (videoUrl) {
        links.push(`
            <a href="${escapeHTML(videoUrl)}"
               target="_blank" rel="noopener noreferrer">
                ▶ Open video resource
            </a>
        `);
    }

    files.forEach(file => {
        const url = safeUrl(
            file.fileUrl ||
            file.url ||
            file.downloadURL ||
            file.downloadUrl
        );

        if (!url) return;

        const name = file.fileName || file.name || "Attachment";

        links.push(`
            <a href="${escapeHTML(url)}"
               target="_blank" rel="noopener noreferrer">
                📎 ${escapeHTML(name)}
            </a>
        `);
    });

    resources.forEach(resource => {
        const url = safeUrl(
            typeof resource === "string"
                ? resource
                : resource.url || resource.link
        );

        if (!url) return;

        const label = typeof resource === "string"
            ? resource
            : resource.title || resource.label || url;

        links.push(`
            <a href="${escapeHTML(url)}"
               target="_blank" rel="noopener noreferrer">
                ↗ ${escapeHTML(label)}
            </a>
        `);
    });

    if (!links.length) return "";

    return `
        <div class="preview">
            <h3>Attachments and learning resources</h3>
            <div class="resources">
                ${links.join("")}
            </div>
        </div>
    `;
}

/* =====================================================
   CONTENT CARD
===================================================== */

function renderCard(item) {
    const status = getStatus(item);
    const assigned = isAssignedToTeacher(item);

    const statusClass = assigned
        ? "published"
        : status === "approved"
            ? "approved"
            : status === "rejected"
                ? "rejected"
                : "";

    const statusLabel = assigned
        ? "Published"
        : status === "approved"
            ? "Approved — awaiting assignment"
            : status === "rejected"
                ? "Rejected"
                : "Pending review";

    const description = item.description || "";
    const body = item.content || "";

    const objectives = Array.isArray(item.learningObjectives)
        ? item.learningObjectives.join("\n• ")
        : item.learningObjectives || "";

    let actionArea = "";

    if (status === "pending") {
        actionArea = `
            <div class="assignment">
                <p class="review-hint">
                    Review this content first. After approval, you can choose
                    the section that will receive it.
                </p>
                <div class="actions">
                    <button class="btn approve"
                        data-action="approve"
                        data-id="${escapeHTML(item.id)}"
                        data-type="${item.type}">
                        ✓ Approve Content
                    </button>

                    <button class="btn reject"
                        data-action="reject"
                        data-id="${escapeHTML(item.id)}"
                        data-type="${item.type}">
                        Reject
                    </button>
                </div>
            </div>
        `;
    } else if (status === "approved" && !assigned) {
        actionArea = `
            <div class="assignment">
                <label for="section-${escapeHTML(item.id)}">
                    Select section to publish this ${item.type}
                </label>

                <select id="section-${escapeHTML(item.id)}"
                    ${!teacherSections.length ? "disabled" : ""}>
                    ${sectionOptions(item)}
                </select>

                <div class="actions">
                    <button class="btn publish"
                        data-action="publish"
                        data-id="${escapeHTML(item.id)}"
                        data-type="${item.type}"
                        ${!teacherSections.length ? "disabled" : ""}>
                        Publish to Students
                    </button>
                </div>
            </div>
        `;
    } else if (assigned) {
        const section = teacherSections.find(
            s => item.sectionIds?.includes(s.id)
        );

        actionArea = `
            <div class="published-info">
                ✓ Published to:
                <strong>${escapeHTML(
                    section?.name ||
                    item.sectionIds?.join(", ") ||
                    "Assigned section"
                )}</strong>
            </div>
        `;
    } else if (status === "rejected") {
        actionArea = `
            <div class="published-info">
                Rejection reason:
                ${escapeHTML(item.reviewFeedback || "No reason provided.")}
            </div>
        `;
    }

    return `
        <article class="content-card">
            <div class="card-top">
                <div>
                    <h2>${escapeHTML(item.title || "Untitled content")}</h2>
                    <span class="status ${statusClass}">
                        ${statusLabel}
                    </span>
                </div>
                <span class="type">${item.type}</span>
            </div>

            ${description ? `
                <p class="description">${escapeHTML(description)}</p>
            ` : ""}

            <div class="meta">
                <span>By: ${escapeHTML(item.createdByName || "Admin")}</span>
                <span>Duration: ${escapeHTML(item.estimatedDuration || item.duration || "Not specified")}</span>
                ${item.moduleName
                    ? `<span>Module: ${escapeHTML(item.moduleName)}</span>`
                    : ""}
            </div>

            ${objectives || body ? `
                <div class="preview">
                    ${objectives ? `
                        <h3>Learning objectives</h3>
                        <div class="preview-content">• ${escapeHTML(objectives)}</div>
                    ` : ""}

                    ${body ? `
                        <h3 style="margin-top:14px">Content preview</h3>
                        <div class="preview-content">${escapeHTML(body)}</div>
                    ` : ""}
                </div>
            ` : ""}

            ${renderAttachments(item)}
            ${actionArea}
        </article>
    `;
}

/* =====================================================
   RENDER CONTENT
===================================================== */

function renderContent() {
    const filtered = activeFilter === "all"
        ? allContent
        : allContent.filter(item => item.type === activeFilter);

    if (!filtered.length) {
        contentList.innerHTML = `
            <div class="empty">
                <strong>No Admin content found</strong>
                New Admin-created modules and lessons will appear here.
            </div>
        `;
        return;
    }

    contentList.innerHTML = filtered.map(renderCard).join("");
}

/* =====================================================
   REJECT CONTENT
===================================================== */

async function rejectContent(item) {
    const feedback = (
        window.prompt("Reason for rejecting this content:")
        || ""
    ).trim();

    if (!feedback) {
        throw new Error("Please provide a reason before rejecting.");
    }

    await updateDoc(
        doc(db, getCollectionName(item), item.id),
        {
            reviewStatus: "rejected",
            status: "rejected",
            reviewedBy: currentTeacher.uid,
            reviewedAt: serverTimestamp(),
            reviewFeedback: feedback,
            updatedAt: serverTimestamp()
        }
    );
}

/* =====================================================
   APPROVE AND PUBLISH
===================================================== */


async function approveContent(item) {
    if (!currentTeacher?.uid) {
        throw new Error("Teacher session is invalid. Please log in again.");
    }

    const contentRef = doc(db, getCollectionName(item), item.id);
    await updateDoc(contentRef, {
        reviewStatus: "approved",
        status: "approved",
        reviewedBy: currentTeacher.uid,
        reviewedAt: serverTimestamp(),
        reviewFeedback: "",
        updatedAt: serverTimestamp()
    });
}

async function publishContent(item, sectionId) {
    const section = teacherSections.find(s => s.id === sectionId);
    if (!section) throw new Error("Invalid section selection.");
    if (!currentTeacher?.uid) {
        throw new Error("Teacher session is invalid. Please log in again.");
    }
    if (getStatus(item) !== "approved") {
        throw new Error("Approve this content before assigning it to a section.");
    }
    if (item.assignedTeacherId && item.assignedTeacherId !== currentTeacher.uid) {
        throw new Error("This content is already assigned to another teacher.");
    }

    const teacherName =
        currentTeacher.fullname ||
        currentTeacher.displayName ||
        currentTeacher.email ||
        "Teacher";

    // Firestore rules intentionally allow one teacher-assigned section per Admin item.
    await updateDoc(doc(db, getCollectionName(item), item.id), {
        status: "active",
        reviewStatus: "approved",
        sectionIds: [sectionId],
        assignedTeacherId: currentTeacher.uid,
        assignedTeacherName: teacherName,
        publishedBy: currentTeacher.uid,
        publishedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });

    return section;
}

/* =====================================================
   ACTION HANDLER
===================================================== */

contentList.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button || button.disabled) return;

    const { action, id, type } = button.dataset;

    const item = allContent.find(content =>
        content.id === id && content.type === type
    );

    if (!item) return;

    if (action === "reject" &&
        !window.confirm("Reject this Admin content?")) {
        return;
    }

    if (action === "approve" &&
        !window.confirm("Approve this Admin content? You can assign its section next.")) {
        return;
    }

    if (action === "publish" &&
        !window.confirm(
            "Publish this approved content to the selected section?"
        )) {
        return;
    }

    button.disabled = true;

    try {
        if (action === "reject") {
            await rejectContent(item);
            showMessage("Content rejected successfully.");
        }

        if (action === "approve") {
            await approveContent(item);
            showMessage(`${item.type === "module" ? "Module" : "Lesson"} approved. Select a section and publish it to students next.`);
        }

        if (action === "publish") {
            const sectionId = $(`section-${item.id}`)?.value;

            if (!sectionId) {
                throw new Error("Select your assigned section first.");
            }

            const section = await publishContent(item, sectionId);

            // Firestore visibility is already active. Notification delivery is best-effort
            // so a push service issue never rolls back the content publication.
            try {
                const notificationResult = await notifySectionStudents({
                    db,
                    auth,
                    sectionIds: [sectionId],
                    contentType: item.type,
                    contentId: item.id,
                    contentTitle: item.title || "New learning content",
                    teacherName:
                        currentTeacher.fullname ||
                        currentTeacher.displayName ||
                        currentTeacher.email ||
                        "Your Teacher"
                });
                console.info("[ADMIN CONTENT] Student notifications:", notificationResult);
            } catch (notificationError) {
                console.warn("[ADMIN CONTENT] Published, but student notification delivery failed:", notificationError);
            }

            showMessage(`Content successfully published to ${section.name}. It is now available to students in that section.`);
        }

        await loadAdminContent();

        } catch (error) {
        console.error("ADMIN CONTENT ACTION ERROR:", {
            action,
            itemId: item?.id,
            itemType: item?.type,
            errorCode: error.code,
            errorMessage: error.message,
            error
        });

        showMessage(
            `Action failed: ${error.code || error.message || "Unknown error"}`,
            "error"
        );

        button.disabled = false;
    }
});

/* =====================================================
   FILTER TABS
===================================================== */

document.querySelectorAll("[data-filter]").forEach(button => {
    button.addEventListener("click", () => {
        document.querySelectorAll("[data-filter]")
            .forEach(tab => tab.classList.remove("active"));

        button.classList.add("active");
        activeFilter = button.dataset.filter;

        renderContent();
    });
});

/* =====================================================
   INITIALIZATION
===================================================== */

requireRole("teacher", async user => {
    try {
        currentTeacher = user;

        contentList.innerHTML = `
            <div class="empty">
                Loading your sections and Admin content...
            </div>
        `;

        await loadTeacherSections();
        await loadAdminContent();

        if (!teacherSections.length) {
            showMessage(
                "No sections are assigned to your teacher account. Ask Admin to assign your section first.",
                "error"
            );
        }

    } catch (error) {
        console.error("TEACHER ADMIN CONTENT LOAD ERROR:", error);

        contentList.innerHTML = `
            <div class="empty">
                <strong>Unable to load Admin content</strong>
                ${escapeHTML(error.message || "Please try again.")}
            </div>
        `;

        showMessage(
            `Loading failed: ${error.code || error.message}`,
            "error"
        );
    }
});
