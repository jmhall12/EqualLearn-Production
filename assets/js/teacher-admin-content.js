
import { auth, db } from "./firebase-config.js";
import { requireRole } from "./session.js";

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

function getStatus(item) {
    return item.reviewStatus || "pending";
}

function isAssignedToTeacher(item) {
    return item.assignedTeacherId === currentTeacher.uid
        && item.status === "active";
}

function updateSummary() {
    const pending = allContent.filter(item =>
        getStatus(item) === "pending"
    ).length;

    const approved = allContent.filter(item =>
        getStatus(item) === "approved" && !isAssignedToTeacher(item)
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
   LOAD ADMIN MODULES AND LESSONS
===================================================== */

async function loadAdminContent() {
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
            name: item.fileName || "Open attachment",
            url: item.fileUrl
        }]
        : [];

    const files = [...attachments, ...legacyFile];

    if (!files.length && !resources.length && !item.videoUrl) {
        return "";
    }

    return `
        <div class="resources">
            ${item.videoUrl ? `
                <a href="${escapeHTML(item.videoUrl)}"
                   target="_blank" rel="noopener">
                    ▶ Open video resource
                </a>` : ""}

            ${files.map(file => {
                const url = file.url || file.downloadURL || file.downloadUrl;
                if (!url) return "";

                return `
                    <a href="${escapeHTML(url)}"
                       target="_blank" rel="noopener">
                        📎 ${escapeHTML(file.name || file.fileName || "Attachment")}
                    </a>`;
            }).join("")}

            ${resources.map(resource => {
                const url = typeof resource === "string"
                    ? resource
                    : resource.url || resource.link;

                const label = typeof resource === "string"
                    ? resource
                    : resource.title || resource.label || url;

                if (!url) return "";

                return `
                    <a href="${escapeHTML(url)}"
                       target="_blank" rel="noopener">
                        ↗ ${escapeHTML(label)}
                    </a>`;
            }).join("")}
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
        : status === "approved" ? "approved" : "";

    const statusLabel = assigned
        ? "Published"
        : status === "approved"
            ? "Approved — awaiting assignment"
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
                <label for="section-${escapeHTML(item.id)}">
                    Select the section that will receive this ${item.type}
                </label>

                <select id="section-${escapeHTML(item.id)}">
                    ${sectionOptions(item)}
                </select>

                <div class="actions">
                    <button class="btn approve"
                        data-action="approve-publish"
                        data-id="${escapeHTML(item.id)}"
                        data-type="${item.type}">
                        ✓ Approve &amp; Publish
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

                <select id="section-${escapeHTML(item.id)}">
                    ${sectionOptions(item)}
                </select>

                <div class="actions">
                    <button class="btn publish"
                        data-action="publish"
                        data-id="${escapeHTML(item.id)}"
                        data-type="${item.type}">
                        Publish to Students
                    </button>
                </div>
            </div>
        `;
    } else if (assigned) {
        const section = teacherSections.find(
            s => s.id === item.sectionIds?.[0]
        );

        actionArea = `
            <p class="description">
                Published to: ${escapeHTML(section?.name || item.sectionIds?.[0] || "Assigned section")}
            </p>
        `;
    }

    return `
        <article class="content-card">
            <div class="card-top">
                <div>
                    <h2>${escapeHTML(item.title || "Untitled content")}</h2>
                    <span class="status ${statusClass}">${statusLabel}</span>
                </div>
                <span class="type">${item.type}</span>
            </div>

            <p class="description">${escapeHTML(description)}</p>

            <div class="meta">
                <span>By: ${escapeHTML(item.createdByName || "Admin")}</span>
                <span>Duration: ${escapeHTML(item.estimatedDuration || "Not specified")}</span>
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
   REVIEW ADMIN CONTENT
===================================================== */

async function reviewContent(item, decision) {
    const feedback = decision === "rejected"
        ? (window.prompt("Reason for rejecting this content:") || "").trim()
        : "";

    if (decision === "rejected" && !feedback) {
        throw new Error("Please provide a reason before rejecting.");
    }

    const collectionName = item.type === "module"
        ? "modules"
        : "lessons";

    await updateDoc(doc(db, collectionName, item.id), {
        reviewStatus: decision,
        status: decision,
        reviewedBy: currentTeacher.uid,
        reviewedAt: serverTimestamp(),
        reviewFeedback: feedback,
        updatedAt: serverTimestamp()
    });
}

/* =====================================================
   PUBLISH CONTENT
===================================================== */

async function publishContent(item, sectionId) {
    const section = teacherSections.find(s => s.id === sectionId);

    if (!section) {
        throw new Error("Invalid section selection.");
    }

    const collectionName = item.type === "module"
        ? "modules"
        : "lessons";

    await updateDoc(doc(db, collectionName, item.id), {
        status: "active",
        sectionIds: [sectionId],
        assignedTeacherId: currentTeacher.uid,
        assignedTeacherName:
            currentTeacher.fullname ||
            currentTeacher.displayName ||
            currentTeacher.email ||
            "Teacher",
        publishedBy: currentTeacher.uid,
        publishedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
}

/* =====================================================
   ONE-CLICK APPROVE AND PUBLISH
===================================================== */

async function approveAndPublish(item) {
    const select = $(`section-${item.id}`);
    const sectionId = select?.value;

    if (!sectionId) {
        throw new Error("Select your assigned section first.");
    }

    const section = teacherSections.find(s => s.id === sectionId);

    if (!section) {
        throw new Error("Invalid section selection.");
    }

    const collectionName = item.type === "module"
        ? "modules"
        : "lessons";

    // Step 1: Approve the Admin content.
    await reviewContent(item, "approved");

    // Step 2: Immediately publish it to the selected section.
    await publishContent(item, sectionId);

    return section;
}

/* =====================================================
   ACTION HANDLER
===================================================== */

contentList.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const { action, id, type } = button.dataset;

    const item = allContent.find(content =>
        content.id === id && content.type === type
    );

    if (!item) return;

    if (action === "reject" &&
        !window.confirm("Reject this Admin content?")) {
        return;
    }

    if (action === "approve-publish" &&
        !window.confirm("Approve and immediately publish this content to the selected section?")) {
        return;
    }

    if (action === "publish" &&
        !window.confirm("Publish this content to the selected section?")) {
        return;
    }

    button.disabled = true;

    try {
        if (action === "approve-publish") {
            const section = await approveAndPublish(item);

            showMessage(
                `${item.type === "module" ? "Module" : "Lesson"} approved and published successfully to ${section.name}.`
            );
        } else if (action === "reject") {
            await reviewContent(item, "rejected");
            showMessage("Content rejected.");
        } else if (action === "publish") {
            const sectionId = $(`section-${item.id}`)?.value;

            if (!sectionId) {
                throw new Error("Select your assigned section first.");
            }

            const section = await publishContent(item, sectionId);

            showMessage(`Content successfully published to ${section.name}.`);
        }

        await loadAdminContent();

    } catch (error) {
        console.error("ADMIN CONTENT ACTION ERROR:", error);

        showMessage(
            `Action failed: ${error.code || error.message || "Unknown error"}`,
            "error"
        );

        // Refresh in case approval succeeded but publishing failed.
        try {
            await loadAdminContent();
        } catch (reloadError) {
            console.error("CONTENT RELOAD ERROR:", reloadError);
        }
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
