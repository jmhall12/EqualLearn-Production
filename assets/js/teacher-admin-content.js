
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
    const publishedStatus = item.collectionName === "modulesV2"
        ? "published"
        : "active";

    return item.assignedTeacherId === currentTeacher?.uid
        && item.status === publishedStatus
        && getStatus(item) === "approved";
}

function getCollectionName(item) {
    // Keep older Admin modules working while all new Admin modules use V2.
    return item.collectionName || (item.type === "module" ? "modulesV2" : "lessons");
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
        !item.assignedTeacherId
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

    const modulesV2 = collection(db, "modulesV2");
    const legacyModules = collection(db, "modules");

    // Each query is constrained to documents the current Teacher is allowed
    // to read. Do not query all approved modules: that would include content
    // already assigned to other Teachers and Firestore would deny the query.
    const jobs = [
        {
            label: "V2 modules pending review",
            collectionName: "modulesV2",
            type: "module",
            request: getDocs(query(
                modulesV2,
                where("createdByRole", "==", "admin"),
                where("reviewStatus", "==", "pending")
            ))
        },
        {
            label: "V2 modules approved and unassigned",
            collectionName: "modulesV2",
            type: "module",
            request: getDocs(query(
                modulesV2,
                where("createdByRole", "==", "admin"),
                where("reviewStatus", "==", "approved"),
                where("assignedTeacherId", "==", null)
            ))
        },
        {
            label: "V2 modules assigned to this Teacher",
            collectionName: "modulesV2",
            type: "module",
            request: getDocs(query(
                modulesV2,
                where("createdByRole", "==", "admin"),
                where("reviewStatus", "==", "approved"),
                where("assignedTeacherId", "==", currentTeacher.uid)
            ))
        },
        {
            // Backward compatibility for Admin modules created before this fix.
            label: "Legacy modules pending review",
            collectionName: "modules",
            type: "module",
            request: getDocs(query(
                legacyModules,
                where("createdByRole", "==", "admin"),
                where("reviewStatus", "==", "pending")
            ))
        },
        {
            label: "Legacy modules assigned to this Teacher",
            collectionName: "modules",
            type: "module",
            request: getDocs(query(
                legacyModules,
                where("createdByRole", "==", "admin"),
                where("reviewStatus", "==", "approved"),
                where("assignedTeacherId", "==", currentTeacher.uid)
            ))
        },
        {
            label: "Admin lessons",
            collectionName: "lessons",
            type: "lesson",
            request: getDocs(query(
                collection(db, "lessons"),
                where("createdByRole", "==", "admin"),
                where("reviewStatus", "in", ["pending", "approved"])
            ))
        }
    ];

    const results = await Promise.allSettled(jobs.map(job => job.request));
    const contentByKey = new Map();
    const failures = [];

    results.forEach((result, index) => {
        const job = jobs[index];

        if (result.status === "rejected") {
            failures.push({ label: job.label, error: result.reason });
            console.warn(`[TEACHER ADMIN CONTENT] ${job.label} could not be loaded:`, {
                code: result.reason?.code,
                message: result.reason?.message,
                error: result.reason
            });
            return;
        }

        result.value.docs.forEach(snapshot => {
            const item = {
                id: snapshot.id,
                type: job.type,
                collectionName: job.collectionName,
                ...snapshot.data()
            };

            contentByKey.set(`${job.collectionName}/${snapshot.id}`, item);
        });
    });

    if (!contentByKey.size && failures.length === jobs.length) {
        throw failures[0].error || new Error("No Admin content query could be loaded.");
    }

    if (failures.length) {
        showMessage(
            `Some content sources could not be loaded: ${failures.map(item => item.label).join(", ")}. Check the deployed Firestore Rules for modulesV2.`,
            "error"
        );
    }

    allContent = [...contentByKey.values()].sort((a, b) => {
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
    const assignedToOtherTeacher = Boolean(
        item.assignedTeacherId && item.assignedTeacherId !== currentTeacher?.uid
    );

    const statusClass = (assigned || assignedToOtherTeacher)
        ? "published"
        : status === "approved"
            ? "approved"
            : status === "rejected"
                ? "rejected"
                : "pending";

    const statusLabel = assigned
        ? "Published"
        : assignedToOtherTeacher
            ? "Assigned to another teacher"
            : status === "approved"
                ? "Approved · ready to publish"
                : status === "rejected"
                    ? "Rejected"
                    : "Pending review";

    const description = item.description || "";
    const body = item.content || "";
    const objectives = Array.isArray(item.learningObjectives)
        ? item.learningObjectives.join("\n• ")
        : item.learningObjectives || "";

    let actionArea = "";

    if (assignedToOtherTeacher) {
        actionArea = `
            <div class="published-info">
                This Admin content has already been assigned to another teacher.
            </div>
        `;
    } else if (status === "pending") {
        actionArea = `
            <div class="assignment">
                <p class="review-hint">Review this content first. After approval, choose the section that will receive it.</p>
                <div class="actions">
                    <button class="btn approve"
                        data-action="approve"
                        data-id="${escapeHTML(item.id)}"
                        data-type="${item.type}"
                        data-collection-name="${escapeHTML(item.collectionName || getCollectionName(item))}">
                        Approve content
                    </button>
                    <button class="btn reject"
                        data-action="reject"
                        data-id="${escapeHTML(item.id)}"
                        data-type="${item.type}"
                        data-collection-name="${escapeHTML(item.collectionName || getCollectionName(item))}">
                        Reject
                    </button>
                </div>
            </div>
        `;
    } else if (status === "approved" && !assigned) {
        actionArea = `
            <div class="assignment">
                <label for="section-${escapeHTML(item.id)}">Choose a section to publish this ${item.type}</label>
                <select id="section-${escapeHTML(item.id)}" ${!teacherSections.length ? "disabled" : ""}>
                    ${sectionOptions(item)}
                </select>
                <div class="actions">
                    <button class="btn publish"
                        data-action="publish"
                        data-id="${escapeHTML(item.id)}"
                        data-type="${item.type}"
                        data-collection-name="${escapeHTML(item.collectionName || getCollectionName(item))}"
                        ${!teacherSections.length ? "disabled" : ""}>
                        Publish to students
                    </button>
                </div>
            </div>
        `;
    } else if (assigned) {
        const section = teacherSections.find(sectionItem =>
            item.sectionIds?.includes(sectionItem.id)
        );
        actionArea = `
            <div class="published-info">
                Published to <strong>${escapeHTML(section?.name || item.sectionIds?.join(", ") || "Assigned section")}</strong>
            </div>
        `;
    } else if (status === "rejected") {
        actionArea = `
            <div class="published-info rejected-info">
                Rejection reason: ${escapeHTML(item.reviewFeedback || "No reason provided.")}
            </div>
        `;
    }

    const detailId = `content-details-${escapeHTML(item.collectionName || getCollectionName(item))}-${escapeHTML(item.id)}`;
    const shortMeta = [
        item.createdByName || "Administrator",
        item.estimatedDuration || item.duration ? `${item.estimatedDuration || item.duration} min` : ""
    ].filter(Boolean).join(" · ");

    return `
        <article class="content-card" data-content-card>
            <button class="content-summary-toggle" type="button"
                data-content-toggle aria-expanded="false" aria-controls="${detailId}">
                <span class="content-kind-icon" aria-hidden="true">
                    ${item.type === "module" ? `
                        <svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 5.5v15M8 7h8M8 11h8"/></svg>
                    ` : `
                        <svg viewBox="0 0 24 24"><path d="M6 3.5h9l4 4V20a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2z"/><path d="M14 3.5V8h5M8 12h8M8 16h8"/></svg>
                    `}
                </span>
                <span class="content-summary-copy">
                    <strong class="content-title">${escapeHTML(item.title || "Untitled content")}</strong>
                    <span class="content-summary-meta">
                        <span class="type-label">${item.type === "module" ? "Module" : "Lesson"}</span>
                        <span class="status ${statusClass}">${statusLabel}</span>
                        <span class="content-byline">${escapeHTML(shortMeta)}</span>
                    </span>
                </span>
                <span class="content-open-label">View details</span>
                <span class="content-chevron" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
                </span>
            </button>

            <div class="content-details" id="${detailId}" hidden>
                ${description ? `<p class="description">${escapeHTML(description)}</p>` : ""}

                <div class="meta">
                    <span>Created by: ${escapeHTML(item.createdByName || "Administrator")}</span>
                    <span>Duration: ${escapeHTML(item.estimatedDuration || item.duration || "Not specified")}</span>
                    ${item.moduleName ? `<span>Module: ${escapeHTML(item.moduleName)}</span>` : ""}
                </div>

                ${objectives || body ? `
                    <div class="preview">
                        ${objectives ? `
                            <h3>Learning objectives</h3>
                            <div class="preview-content">• ${escapeHTML(objectives)}</div>
                        ` : ""}
                        ${body ? `
                            <h3 class="body-heading">Content preview</h3>
                            <div class="preview-content">${escapeHTML(body)}</div>
                        ` : ""}
                    </div>
                ` : ""}

                ${renderAttachments(item)}
                ${actionArea}
            </div>
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

    // V2 modules are read by students only when status is "published".
    // Legacy lessons/modules keep their existing "active" status contract.
    const collectionName = getCollectionName(item);
    const publishedStatus = collectionName === "modulesV2" ? "published" : "active";

    // Firestore rules intentionally allow one teacher-assigned section per Admin item.
    await updateDoc(doc(db, collectionName, item.id), {
        status: publishedStatus,
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
    const toggle = event.target.closest("button[data-content-toggle]");
    if (toggle) {
        const card = toggle.closest("[data-content-card]");
        const details = card?.querySelector(".content-details");
        if (details) {
            const willOpen = details.hidden;
            details.hidden = !willOpen;
            toggle.setAttribute("aria-expanded", String(willOpen));
            card.classList.toggle("is-open", willOpen);
        }
        return;
    }

    const button = event.target.closest("button[data-action]");
    if (!button || button.disabled) return;

    const { action, id, type, collectionName } = button.dataset;

    const item = allContent.find(content =>
        content.id === id
        && content.type === type
        && (!collectionName || getCollectionName(content) === collectionName)
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
