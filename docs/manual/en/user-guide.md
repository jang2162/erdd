# ERDD user guide

This is a **feature reference** for people who design ERDs in the web UI (designers, developers, reviewers) and for organization admins. It is not a tutorial, so open only the section for the feature you need. Each section follows the same order: **What** (the feature) · **Where** (its location) · **How** (the steps) · **Limits** (permissions, caps, caveats). The ERDD interface is in Korean. Text that appears on screen is shown in bold exactly as it appears, followed by an English translation in parentheses the first time it appears. Installation, operations, and running the server are in [install.md](./install.md), and the command-line tool is in [cli-guide.md](./cli-guide.md). If you opened **local mode with `erdd serve`, without a server**, read [local-guide.md](./local-guide.md) as well. The editor is the same, but 6 of the 20 chapters below do not apply and 2 work differently.

**Contents** — [1. Accounts and login](#1-accounts-and-login) · [2. Screen map](#2-screen-map) · [3. Organizations, projects, and permissions](#3-organizations-projects-and-permissions) · [4. Editor basics](#4-editor-basics) · [5. Tables and columns](#5-tables-and-columns) · [6. Relationships](#6-relationships) · [7. Indexes and notes](#7-indexes-and-notes) · [8. Groups and group views](#8-groups-and-group-views) · [9. Domains](#9-domains) · [10. Naming system (word and term dictionary)](#10-naming-system-word-and-term-dictionary) · [11. Custom fields](#11-custom-fields) · [12. Model check](#12-model-check) · [13. Shared resources](#13-shared-resources) · [14. Versions (history, snapshots, comparison)](#14-versions-history-snapshots-comparison) · [15. Export](#15-export) · [16. Import](#16-import) · [17. Real-time co-editing](#17-real-time-co-editing) · [18. Access tokens](#18-access-tokens) · [19. Admin tasks](#19-admin-tasks) · [20. Selection and copy](#20-selection-and-copy)

---

## 1. Accounts and login

> **Not available in local mode.** There is no account and no login screen. The editor opens directly (→ [local mode manual](./local-guide.md)).

**What** — ERDD has no self sign-up. You create your account yourself by opening a **one-time invite link issued by an admin**. The same applies when you forget your password: an admin issues a reset link and hands it to you.

**Where** — `/login` (login), `/invite/:token` (accept an invite), `/reset/:token` (reset a password). All three screens **open without logging in**.

**How — log in** — On `/login`, enter **이메일** (Email) and **비밀번호** (Password), then click **로그인** (Log in). While it works, the button shows **확인 중…** (Checking…). On success, you go to the home screen (`/`). If you have no account, the screen says **계정이 없다면 관리자에게 요청하세요.** ("If you do not have an account, ask an admin.").

**How — create an account from an invite link** — Open the `/invite/:token` link the admin sent you (title **초대 수락**, Accept invite). The box shows the invited email. For an organization invite, it also shows the organization and role you will join, for example **조직 〈이름〉에 관리자(으)로 참여합니다** ("You will join organization 〈name〉 as admin"). Enter **이름** (Name), **비밀번호** (Password), and **비밀번호 확인** (Confirm password), then click **계정 만들기** (Create account). The button shows **만드는 중…** (Creating…). ERDD creates the account and takes you to the login screen. **It does not log you in automatically.**

**How — reset a password** — On `/reset/:token` (title **비밀번호 재설정**, Reset password), enter **새 비밀번호** (New password) and **새 비밀번호 확인** (Confirm new password), then click **비밀번호 설정** (Set password). On success, you go to the login screen.

**Limits**

| Item | Value or behavior |
|---|---|
| Invite link validity | 7 days after issue |
| Reset link validity | 24 hours after issue |
| Minimum password length | 8 characters |
| After a successful reset | **새 비밀번호를 정하면 다른 기기의 로그인이 모두 해제됩니다.** ("Setting a new password logs you out on all other devices.") |
| Issuing a reset link alone | Does not change the password and keeps login sessions alive |

If the two password entries differ, **비밀번호가 서로 다릅니다** ("The passwords do not match") appears. If the link cannot proceed, the form disappears and a reason appears. There are two possible next steps. **If you can get a new link** (the link does not exist, has expired, or was revoked), the message is **관리자에게 문의해 새 링크를 받으세요.** ("Ask an admin for a new link."). **If an account already exists for that email**, the message is **이 이메일에는 이미 계정이 있습니다 — 새 링크를 받을 수는 없으니 로그인하세요. 비밀번호를 모르면 관리자에게 재설정 링크를 요청하세요.** ("This email already has an account. You cannot get a new link, so log in. If you do not know the password, ask an admin for a reset link."). The second case means an invite for the same email cannot be created again.

A temporary failure (network loss, server error) does not kill the link. **지금은 처리하지 못했습니다. 잠시 후 다시 시도하세요.** ("This could not be processed right now. Try again in a moment.") appears, and **what you entered stays**, so click the same button again. If the invite screen cannot load its information, a **다시 시도** (Retry) button appears.

---

## 2. Screen map

> **Different in local mode.** There are only two screens: the editor and project settings (→ [local mode manual 4.1](./local-guide.md#41-there-are-only-two-screens)).

**What** — There are 9 screens in total. Most need a login. Only the three one-time link and login screens are exceptions.

**Where** — After you log in, a common top bar appears. The logo on the left goes home. On the right are the pending promotion request badge (→ [section 13](#13-shared-resources)) and the user menu. Only the editor uses a dedicated full-screen layout with its own header.

**The version of ERDD you are using** appears in small text next to the logo, in both the top bar and the editor header (in the form `v0.5.0`). It is the same value as the CLI's `erdd --version`. It is different from the editor's **버전** (Versions) feature, which handles the model's history (→ [section 14](#14-versions-history-snapshots-comparison)).

| Path | Screen | Protection | Content |
|---|---|---|---|
| `/login` | Login | Public | Email and password login |
| `/invite/:token` | Accept invite | Public | Create an account from an invite link |
| `/reset/:token` | Reset password | Public | Set a new password from a reset link |
| `/` | Home | Login | **〈이름〉님의 작업 공간** (〈name〉's workspace): your organization cards and **팀 조직 만들기** (Create team organization) |
| `/org/:orgId` | Organization details | Login | Project list and creation, members, invites, promotion requests, organization shared resources |
| `/p/:projectId` | ERD editor | Login | Canvas, tree, edit panel, and every editor feature |
| `/p/:projectId/settings` | Project settings | Login | Project information, naming rules (logical name separator, table physical name format, table logical name format), table options, project member management |
| `/settings` | My settings | Login | Change password, access tokens |
| `/admin` | Account management | Login + service role `admin` | Account invites and status, invite list, global shared resources |

A path that does not exist shows **페이지를 찾을 수 없습니다** ("Page not found") and **홈으로** (Go home). The user menu (your name) shows your email along with **설정** (Settings) and **로그아웃** (Log out). If your service role is `admin`, **관리자** (Admin) also appears.

---

## 3. Organizations, projects, and permissions

> **Not available in local mode.** There are no organizations, members, or roles, and you always have manage permission (→ [local mode manual section 1](./local-guide.md#1-who-this-document-is-for)).

**What** — An organization is the unit of member management, and one project is one DB schema. Permissions are decided by **three role axes** that overlap.

**Where** — Choose an organization on the home screen (`/`). Create projects and manage members on the organization details screen (`/org/:orgId`). Manage project members in project settings (`/p/:projectId/settings`).

| Axis | Values | Where it is set | Nature |
|---|---|---|---|
| Service role | `admin` / `user` (**관리자** Admin / **일반** Regular) | When an admin invites the account (`/admin`) | Administrator of the whole service. It is the only role that can enter the `/admin` screen, and it is a separate axis from organization and project permissions |
| Organization role | `owner` / `admin` / `member` | The **멤버** (Members) table on the organization details screen | See the table below |
| Project role | `admin` / `editor` / `viewer` | **프로젝트 멤버** (Project members) in project settings | See the table below |

| What an organization role can do | Owner | Admin | Member |
|---|:---:|:---:|:---:|
| Create projects | ○ | ○ | ✕ |
| Add or remove members, change roles | ○ | ○ | ✕ |
| Make, demote, or remove an Owner | ○ | ✕ | ✕ |
| Issue and revoke organization invite links | ○ | ○ | ✕ |
| Manage organization libraries, approve promotion requests | ○ | ○ | ✕ |
| Project access | All in the organization | All in the organization | Only those they are invited to |

The last Owner cannot be demoted or removed (**마지막 Owner는 강등할 수 없습니다**, "The last Owner cannot be demoted"). An operation without permission is rejected with **조직 관리 권한이 없습니다** ("You do not have permission to manage the organization").

On the project side, the server checks three levels of required access.

| Level | Who passes | What it allows |
|---|---|---|
| View | Org Owner/Admin, or a project member with any role | View the model, export, join real-time sessions |
| Edit | Org Owner/Admin, Project Admin/Editor | All model editing |
| Manage | Org Owner/Admin, Project Admin | Manage project members, restore and delete snapshots |

A Viewer can enter the editor, but the bottom bar shows only a **읽기 전용** (Read-only) badge where the editing tools would be, and dragging nodes, connecting relationships, and deleting are locked. Any edit attempt shows **이 프로젝트에 대한 편집 권한이 없습니다** ("You do not have permission to edit this project").

**How — create an organization or project** — On the home screen, click **팀 조직 만들기** (Create team organization) → **조직 이름** (Organization name) → **만들기** (Create). The creator becomes the Owner. On the organization details screen, click **프로젝트 만들기** (Create project) → **이름** (Name), **설명 (선택)** (Description, optional), **대상 DB 방언** (Target DB dialects) → **만들기** (Create). The creator becomes the Project Admin. There are four dialects: **PostgreSQL**, **MySQL·MariaDB**, **Oracle**, and **MSSQL**, and you can turn on several (the default is PostgreSQL). If you choose none, **대상 DB를 하나 이상 선택하세요** ("Select at least one target DB") appears.

**How — add members** — For someone who **has** an account, enter their email in **이메일로 추가** (Add by email) under **멤버** (Members) on the organization details screen, choose a role (Member/Admin), and click **추가** (Add). For someone who **does not** have an account, create a link in the **초대** (Invites) section of the same screen (→ [section 19](#19-admin-tasks)). The screen itself says **아직 계정이 없는 사람을 부릅니다. 이미 가입한 사람은 위 멤버 추가를 쓰세요.** ("Invites people who do not have an account yet. For people who already signed up, use Add member above."). To add someone to a project, go to project settings → **프로젝트 멤버** (Project members) → **조직 멤버 추가** (Add organization member), choose the person and Admin/Editor/Viewer, and click **추가** (Add). **Only people who are already organization members** appear as candidates.

**Limits**

- When you create an account, a **personal organization** named **〈이름〉의 공간** (〈name〉's space) is created automatically with you as its Owner. Its home card has a **개인 공간** (Personal space) badge and comes first in the list. You cannot add members to a personal organization (**개인 조직에는 멤버를 추가할 수 없습니다**, "You cannot add members to a personal organization") or create invites for it, so the **멤버** (Members) and **초대** (Invites) sections do not appear.
- **In project settings, you can change project members; the logical name separator toggle, table physical name format, and table logical name format under 명명 규칙 (Naming rules); and the four dialect fields under 테이블 옵션 (Table options).** The name, description, and target DB dialects are shown read-only. The **논리명을 밑줄로 구분** (Separate logical names with underscores) checkbox in the naming rules section decides whether logical names are written with an underscore between words, as in 「회원_주문_번호」 (member_order_number). It is on by default. Turning it off **does not remove underscores from logical names that are already saved.** The **테이블 물리명 형식** (Table physical name format) field in the same section is a template that composes the table physical name as "prefix + the part you enter". The **테이블 논리명 형식** (Table logical name format) field below it composes the table logical name **in outputs** the same way (→ [section 10](#10-naming-system-word-and-term-dictionary)). The remaining three settings (upper snake case, physical name separator `_`, maximum 30 bytes) have no screen yet. The **테이블 옵션** (Table options) section below holds per-dialect strings appended after `CREATE TABLE` when you export DDL (→ [section 9.1](#91-table-options-engine-charset)). Both sections are visible only with **manage permission**. The dialects stay as they were chosen at creation.

---

## 4. Editor basics

**What** — Three panes, the **table tree** on the left, the **canvas** in the middle, and the **edit panel** on the right, are framed by the **header** at the top and the **bottom bar** at the bottom. The header holds management tools that you open, work in, and close. The bottom bar holds tools that act on the canvas directly or decide how it looks.

**Where** — `/p/:projectId`. The left of the header shows the logo and the ERDD version. The right shows, in order: the avatars of connected users → **버전** (Versions) → **사전·리소스** (Dictionaries & resources) → **모델 검사** (Model check) → **파일** (File) → **설정** (Settings) → the user menu. **사전·리소스** opens a menu with **도메인** (Domains), **단어·용어 사전** (Word and term dictionary), **커스텀 항목** (Custom fields), and **공용 리소스** (Shared resources). **파일** opens a menu with **DDL·DBML 가져오기** (Import DDL/DBML) and **내보내기** (Export).

The **bottom bar** at the very bottom of the screen holds, from left to right: the editing tools (**테이블 추가** Add table, **메모** Note, **자동 정렬** Auto layout, **삭제** Delete) → undo/redo → **뷰 전환** (Switch view) → the view mode (**논리명** Logical, **물리명** Physical, **혼합** Mixed) → and at the far right, zoom (zoom out, zoom level, zoom in, **화면에 맞춤** Fit to screen).

**How — canvas**

| Action | Result |
|---|---|
| Drag empty space / scroll wheel / zoom at the right of the bottom bar | Pan, zoom in and out, fit to screen |
| Click a node / click a relationship line | Selects that table, note, or relationship → the edit panel on the right changes |
| Click empty space | Clears the selection |
| Drag a node | Changes its position (positions are part of the model, so they are saved) |
| Drag a table's left or right handle onto another table | Creates a relationship (→ [section 6](#6-relationships)) |

There is a minimap at the bottom right, and you can drag and zoom the minimap itself.

**The only way to delete a table is the 삭제 (Delete) button on the bottom bar.** If you select a node on the canvas and press `Backspace`, the node disappears from the screen, but **this is not saved**. When you reopen the screen or another edit arrives, it comes back. Always use **삭제** on the bottom bar to delete.

**How — editing tools on the bottom bar** (visible only with edit permission)

| Button | Action | Disabled when |
|---|---|---|
| **테이블 추가** (Add table) | Creates a new table at the center of the screen and selects it | — |
| **메모** (Note) | Creates a note at the center of the screen | You are in a group view |
| **자동 정렬** (Auto layout) | Rearranges visible tables into a hierarchy based on relationships | Fewer than 2 tables are visible |
| **삭제** (Delete) | Deletes the selected tables (all of them, if several) together with their columns, indexes, and relationships | No table is selected |
| **실행 취소** (Undo) / **다시 실행** (Redo) | Reverts the last edit, or reapplies an undone edit | There is nothing to undo or redo |

**Shortcuts** are `Cmd/Ctrl + Z` (undo) and `Cmd/Ctrl + Shift + Z` (redo). The shortcuts for selecting, copying, pasting, and deleting are in [section 20](#20-selection-and-copy). None of them work **while the cursor is in an input field or text area, or while a dialog is open**. In those cases they yield to the browser's default behavior.

**How — table tree** — Type part of a logical or physical name into **테이블 검색** (Search tables) to filter the list (case-insensitive). Tables are grouped by group, and tables not in any group are collected under **미분류** (Ungrouped). Click a table to move the canvas to it and select it. The folder icon to the right of the search box (**그룹 추가**, Add group) creates a new group. With no tables, **테이블을 추가해 설계를 시작하세요.** ("Add a table to start designing.") appears. With no search results, **검색 결과가 없습니다.** ("No results.") appears.

**How — select several items in the tree** — `Cmd`/`Ctrl`+click adds the table to the selection or removes it (toggle). `Shift`+click selects a range **in the order shown on screen**. **Tables that are not visible right now**, because a search filtered them out or they are outside the group view, **are not pulled into the range**. A click without a modifier key leaves only that one table selected. This selection is **the same selection** as the canvas (→ [section 20](#20-selection-and-copy)), so what you choose in the tree is highlighted on the canvas, and what you select with a box on the canvas appears in the tree. Selecting works with read-only permission too.

**How — drag to move between groups** — Grab a tree item and drop it on another group block (or **미분류**, Ungrouped) to change the table's group. **If several items are selected and you grab one of them, all selected items move together.** If you grab an item outside the selection, only that item moves. **Dragging a table node from the canvas onto a group block in the tree** works the same way. While you drag, an **N개 테이블** (N tables) tag follows the cursor and the target group is outlined. **Groups hidden by a search or group view also all appear at this point**, because otherwise you could not drop a table you found into the group you want. The drop works anywhere on the group header, the list below it, or the block's margin. Dropping only tables that are already in that group does nothing.

**How — view mode** — Choose **논리명** (Logical), **물리명** (Physical), or **혼합** (Mixed) from the three-button toggle on the bottom bar. Mixed shows the physical and logical names side by side. The default is **물리명** (Physical).

**Limits** — The undo history keeps **the last 100 steps**, and only **edits you made in this browser session**. Reopening the screen, or resyncing the model because of someone else's edit, clears the history. Undo and redo are also edits sent to the server, so they appear in the history as **실행 취소** (Undo) and **다시 실행** (Redo). Auto layout arranges **only the visible range**, so in a group view only that group's layout changes. When the server rejects an edit, a toast shows the reason and the screen resyncs to the server state.

---

## 5. Tables and columns

**What** — Tables and columns have a separate **logical name** (business term) and **physical name** (DB identifier). When you enter a logical name, the dictionary generates the physical name automatically. For both tables and columns, **the physical name is on top and the logical name below**, stacked vertically. Each input field has an **arrow button** at its right end. The arrow fills **the opposite field**, not the one you clicked.

**Where** — Select a table on the canvas to open the edit panel on the right. With nothing selected, only **테이블을 선택하면 여기서 편집합니다.** ("Select a table to edit it here.") appears.

**How — table** — Type directly into **테이블 물리명** (Table physical name), or use ↑ (**물리명 채우기**, Fill physical name) **in the logical name field** to build the physical name from the logical name. Enter the business name in **논리명** (Logical name). If the physical name was empty, it is generated at that point. Conversely, ↓ (**논리명 채우기**, Fill logical name) **in the physical name field** builds the logical name from the physical name. **The arrow fills the field opposite the one you click** (clicking the arrow in the physical name field changes the logical name). **It works from the value you are typing right now.** You do not need to finish and click elsewhere. Clicking the arrow right away uses what you typed. Use the **소속 그룹** (Group) drop-down to put the table in a group (the default is **미분류**, Ungrouped). If custom fields are defined, a **커스텀 항목** (Custom fields) box follows (→ [section 11](#11-custom-fields)). A new table gets only a placeholder logical name such as 「테이블1」 (Table1), and its physical name is empty. When you change the logical name to a business name, the dictionary generates the physical name.

**How — columns**

1. Click **컬럼 추가** (Add column) next to **컬럼** (Columns). The column is created as 「컬럼1」/`COL_1` with type `VARCHAR(255)`, nullable.
2. Each row has the physical name on top and the logical name below, and both are marked required with 「*」. When you enter a logical name, the physical name is generated **only if the physical name is empty**. If that name matches a dictionary term, **the domain is set as well** (only if the domain is empty). If the physical name is already filled, both stay as they are. Conversely, when you enter a physical name, the dictionary restores the logical name **only if the logical name is empty**. If even one abbreviation is not in the dictionary, it fills nothing.
3. The arrow in each field fills **the opposite field** from your value. ↓ in the physical name field is **논리명 채우기** (Fill logical name), and ↑ in the logical name field is **물리명 채우기** (Fill physical name). If the name cannot be built, a toast shows the reason (**등록되지 않은 약어: GRD, CD**, "Unregistered abbreviations: GRD, CD"). **용어 등록** (Register term) under the names registers the current logical name, physical name, and domain in the term dictionary (→ [section 10](#10-naming-system-word-and-term-dictionary)). It is locked when a term with the same logical name already exists, or when either the logical or physical name is empty. **Both the arrows and 용어 등록 look at the value you are typing right now.** You do not need to finish and click elsewhere, and the cursor stays in the field after you click.
4. **An autocomplete list appears below the field while you type a name.** In the logical name, it suggests dictionary words and terms by prefix match. In the physical name, it suggests abbreviations and term physical names. Move with ↓↑, confirm with Enter, and close with Esc. Confirming **fills in text; it does not save**, so you can keep typing the next word. However, **the opposite field changes along with it on the spot** (only on screen; it is not saved yet). Word suggestions appear only while a **trailing fragment** that is not yet in the dictionary remains. **Terms, however, look at the whole name, so they keep appearing even when the name splits cleanly into dictionary words.** For example, when you have typed 「회원_주문」 (member_order), the term 「회원_주문_번호」 (member_order_number) is suggested. Up to 8 suggestions appear at once, of which at most 3 are terms.
   - When the logical name separator is on, **the trailing fragment is the token after the last underscore**. So in an older name typed without underscores (「회원주」), the whole input is taken as one piece and fewer word suggestions appear. Type one underscore (「회원_주」) and the suggestions come back right away.
5. The **미등록** (Unregistered) line under the names shows, as chips, the parts of the name that are not in the dictionary. Click a chip to open an input field in place. On the logical name side, enter an abbreviation. On the physical name side, enter a logical name. Then click **단어 등록** (Register word) to add it to the dictionary right away. If the same name already exists in the dictionary, it is locked. If only the abbreviation overlaps, only a warning appears. Chips follow the **saved value**, so they do not flicker while you type.
6. In **도메인** (Domain), choose a domain or clear it with **없음** (None).
7. Write the DB type directly in **타입** (Type). **When you set a domain, this field is locked** and shows **〈논리 타입〉 (도메인: 〈이름〉)** ("〈logical type〉 (domain: 〈name〉)") read-only. For integers, you can add **unsigned** as a suffix. There are three: `SMALLINT UNSIGNED`, `INT UNSIGNED`, and `BIGINT UNSIGNED` (a common notation for PK/FK columns in MySQL). Exporting to MySQL DDL writes them as is. In the other three dialects, they are written as a signed type + `CHECK (column >= 0)`.
8. Use the **PK** and **NN** checkboxes to set the primary key and NOT NULL. Change the order with the up and down arrows, and delete with the trash can.

**Limits**

- Input fields take effect **when they lose focus**. After you edit, click another field or move with `Tab` to save. In local mode, `Cmd+S` and **저장** (Save) apply the field with the cursor first and then write the files (→ [local mode manual](local-guide.md#44-edits-stay-in-a-draft-until-you-save)).
- Deleting a column also cleans up the relationship mappings and index columns that used it. A relationship left with no mappings, and an index left with no columns, disappear as well.
- On canvas nodes, a key icon marks a PK and `NN` marks NOT NULL, and the type appears on the right. A table without columns shows **컬럼 없음** (No columns).
- **The edit panel has no fields for table and column descriptions (comments), column defaults, or auto-increment.** The values exist in the model and appear in DDL comments and the Excel specification, but the only ways to fill them on the web are DDL import (→ [section 16](#16-import)) and domain defaults (→ [section 9](#9-domains)).
- Duplicate column physical names within one table, or duplicate table physical names, are graded as **errors**, not warnings (→ [section 12](#12-model-check)).
- Labels of required items (table physical and logical name; column physical name, logical name, and type) have an asterisk, and an empty value is caught as a **필수 값 누락** (Missing required value) warning (→ [section 12](#12-model-check)). **Column rows use a compact layout that does not draw labels, so they have no asterisk.** In those rows, only the warning badge tells you whether a value is required.

---

## 6. Relationships

**What** — A relationship is a foreign key from **child → parent**. It is created by copying the parent's primary key into the child as FK columns.

**Where** — Click a relationship line on the canvas to open the **관계** (Relationship) panel on the right. You create relationships on the canvas.

**How — create** — Grab the left or right handle of the **child** table and drop it on the **parent** table. The child gets as many FK columns as the parent has primary key columns, and duplicate names get `_2`, `_3`. The new relationship is selected immediately. If the parent has no primary key, **부모 테이블에 기본 키가 없습니다** ("The parent table has no primary key") appears and nothing is created.

**How — edit** — The top of the panel shows **〈자식 물리명〉 → 〈부모 물리명〉** (〈child physical name〉 → 〈parent physical name〉).

| Item | Value | Effect |
|---|---|---|
| **카디널리티** (Cardinality) | **1 : N** / **1 : 1** | Changes the canvas notation. For 1:1, a UNIQUE constraint is also written to the DDL |
| **식별 관계 (자식 기본 키 편입)** (Identifying relationship, include in child primary key) | Checkbox | The FK columns become part of the child's primary key. Solid line on the canvas (non-identifying is dashed) |
| **관계명** (Relationship name) | Free text | Leaving it empty saves no name. It is used as the FK constraint name in the DDL |
| **컬럼 매핑** (Column mapping) | Child column for each parent PK | Change the child-side column with the drop-down on the left |

On the canvas, the parent end is always drawn as a bar, and the child end as a crow's foot for 1:N. When you change a mapping to another column, the new column's PK status is adjusted to match the relationship's identifying status, and the previous FK column is deleted only if no relationship or index uses it. Delete with the trash can at the top right (**관계 삭제**, Delete relationship). **The child's FK columns are intentionally kept.** If you do not need them, delete them in the edit panel. Selecting a relationship line and pressing `Delete`/`Backspace` does **exactly the same thing** (→ [section 20](#20-selection-and-copy)).

A relationship line attaches **to the column rows that actually connect**, not to the middle of the table. The child's FK column row connects directly to the parent's referenced column row, so you can see from the diagram which column references what. For a **composite key relationship** with two or more columns, a `(column1, column2)` row appears at the bottom of both tables, and one line connects those rows. This row is **display-only**: you cannot click or select it, and it appears only for the column combinations that relationships actually use. A relationship whose mapping is still empty attaches to the middle of the table's left or right side, as before.

### Resolving into a junction table (N:M)

**What** — The model has no N:M relationship type. Instead, there is an action that turns one 1:N relationship into **one junction table + two identifying 1:N relationships**.

**Where** — **교차 테이블로 풀기** (Resolve into junction table) at the bottom of the relationship panel (only with edit permission).

**How** — Select the 1:N relationship to resolve and click **교차 테이블로 풀기**. The original relationship's FK columns are removed from the child, and the original relationship disappears with them. A junction table appears halfway between the two tables. Its logical name is **the two tables' logical names joined together** (for example, 회원 (member) + 상품 (product) → "회원상품"), and its physical name is generated from the dictionary. **Two identifying 1:N relationships** are created, parent → junction and child → junction, and the junction table's primary key becomes a composite key of both FKs. The selection moves to the junction table so you can refine its name right away.

**Limits — three conditions that block resolving.** When one applies, the button is locked and the reason is shown with it.

| Condition | Message on screen |
|---|---|
| It is an identifying relationship | **식별 관계는 풀 수 없습니다 — 위 "식별 관계" 체크를 먼저 해제하세요** ("Identifying relationships cannot be resolved. Clear the "식별 관계" check above first") |
| The parent has no primary key, **or** the child has no primary key left after removing this relationship's FK columns | **교차 테이블에 넘길 기본 키가 없습니다 — 부모에 기본 키가 있어야 하고, 자식에는 이 관계의 FK 를 뺀 기본 키가 남아야 합니다** ("There is no primary key to pass to the junction table. The parent must have a primary key, and the child must keep a primary key without this relationship's FK") |
| **Another relationship references**, from the parent side, an FK column that would be deleted | **이 관계의 FK 컬럼을 다른 관계가 참조하고 있어 풀 수 없습니다 — 먼저 그 관계를 정리하세요** ("Another relationship references this relationship's FK columns, so it cannot be resolved. Clean up that relationship first") |

The third condition is separate from the identifying relationship guard. Even without an identifying relationship, you can end up with a three-level structure where an FK column only has its PK check on and a grandchild table references that column. Resolving it as is would leave an FK column on the grandchild side that nothing references. That is why it is blocked separately.

This action is a single edit, so **one undo reverts all of it**. If you run it in a group view, the junction table is assigned to that group. If the physical name cannot be built because a word is not in the dictionary, a placeholder physical name in the form `TABLE_n` is used.

---

## 7. Indexes and notes

### Indexes

**What** — Index definitions per table. An index has an ordered list of columns with sort directions, and a UNIQUE flag.

**Where** — The **인덱스** (Indexes) section at the bottom of the edit panel when a table is selected.

**How** — Click **인덱스 추가** (Add index) to create an index with the smallest unused number, such as `IX_1`, `IX_2`. Edit **인덱스명** (Index name) (an empty name is ignored), set uniqueness with **UNIQUE**, and choose columns from the **컬럼 추가…** (Add column…) drop-down below (columns already in the index are left out of the options). In each column row, **ASC**/**DESC** flips the direction, the arrows change the order, and the trash can removes the column from the index.

**Limits** — An index without columns stays as **구성 컬럼 없음** (No columns). With no indexes, **인덱스가 없습니다.** ("No indexes.") appears. Read-only users still see the direction buttons, but they cannot click them (they also serve to display the value).

### Notes

**What** — Free-text sticky notes on the canvas. They are saved as part of the model and edited together with it.

**Where and how** — Click **메모** (Note) on the bottom bar to create a yellow note with the text 「메모」 (Note) at the center of the screen. Click it on the canvas to open the **메모** (Note) panel on the right. Write in **내용** (Content) (line breaks are kept) and choose a background color in **색상** (Color). Delete it with the trash can at the top right (**메모 삭제**, Delete note). You can also select a note and delete it with `Delete`/`Backspace`, or copy, cut, and paste it with `Cmd`/`Ctrl`+`C`, `X`, `V` (→ [section 20](#20-selection-and-copy)).

**Limits** — Notes **appear only in the full view.** In a group view they are hidden, and **메모** on the bottom bar is locked. Notes do not belong to groups.

---

## 8. Groups and group views

**What** — A group bundles tables into a business unit. It is used in two ways: as a **color area** drawn behind the tables in the full view, and as a **group view** that shows only that group.

**Where** — Create one with the folder icon at the top of the tree (**그룹 추가**, Add group). When several tables are selected, a **선택 테이블로 새 그룹** (New group from selected tables) button also appears in the right panel. Click a color area's label on the canvas, or a group name in the tree, to open the **그룹** (Group) panel on the right. Switch views with the **뷰 전환** (Switch view) drop-down on the bottom bar.

**How** — Click **그룹 추가** in the tree to create a group with an unused number, such as 「그룹1」 (Group1), and an automatically assigned color. In the group panel, edit **이름** (Name), **별칭** (Alias), **색상** (Color), and **설명** (Description), and check **소속 테이블 N개** (N tables in group) at the top. There are four ways to put a table in a group: choose **소속 그룹** (Group) in that table's edit panel; **grab an item in the left tree and drop it on a group block**; **drag a table node from the canvas onto a group block in the tree**; or select several tables and move them with the **선택 테이블의 그룹** (Group of selected tables) drop-down in the right panel. If several tables are selected, they all move at once (→ [section 4](#4-editor-basics)). When the group changes, the canvas coordinates are adjusted to place the tables next to the new group. Enter the group view with **이 그룹 뷰 열기** (Open this group view) in the group panel, or with **〈그룹명〉 뷰** (〈group name〉 view) under **뷰 전환** on the bottom bar, and return with **전체 뷰** (Full view). Delete the group with the trash can at the top right of the panel (**그룹 삭제**, Delete group).

**How — alias** — **별칭** (Alias) in the group panel is a short identifier used to compose physical names. Group names are often Korean, such as `회원관리` (member management), so they cannot go into physical names as is, which is why the alias is separate. **Only uppercase English letters, digits, and underscores are allowed.** Lowercase letters become uppercase, and Korean characters and other symbols **cannot be entered at all** (they are filtered as you type). ↑ at the right of the field (**이름으로 별칭 채우기**, Fill alias from name) runs the group name through the dictionary and inserts the abbreviation combination. If a word is not in the dictionary, a toast names that word and the value does not change. It is optional, so you can leave it empty. **It is not used anywhere yet.** It will be consumed in the next stage, when the table name format template is added. With read-only permission it is locked and the fill button does not appear.

**To group tables into a new group rather than an existing one** — Draw a box with `Shift`+drag on the canvas, or select several tables in the tree, then click **선택 테이블로 새 그룹** (New group from selected tables) in the right panel. An unused number such as 「그룹1」 and a color are assigned automatically, all the selected tables go into the group, and the right side immediately switches to the **그룹** panel so you can edit the name, color, and description in place (the table selection is cleared at this point). **The tables stay where they were, and only a color area is laid over them.** If you group tables that are far apart, the area grows accordingly and can appear to cover other tables in between. In that case, drag them into place on the canvas afterward. It is a single edit, so **one undo reverts all of it**.

| | Full view | Group view |
|---|---|---|
| Visible tables | All | Only the tables in that group |
| Color area | A translucent area around the group's tables (solid when selected, dashed otherwise) | Hidden |
| Notes | Visible | Hidden |
| Table positions | Full-view coordinates | **Coordinates for the group view only**, saved separately |
| Relationships to tables outside the group | Normal connecting lines | The other table appears as a **ghost node** |

- **The group view layout is independent.** Moving tables in a group view leaves the full view layout as it is. A table that has no group view coordinates yet starts from its full-view coordinates.
- In the full view, **dragging a color area moves the group's tables with it**. Clicking an empty part of the area clears the selection, and clicking the label selects the group.
- A **ghost node** shows, in a group view, only the header of a table outside the group, semi-transparent. It carries the hint **외부 참조 — 클릭해 이동** ("External reference — click to go"), and clicking it moves you to the group view that table belongs to (or the full view if it is ungrouped). You cannot drag, select, or connect it.
- If someone deletes the group while you are viewing its group view, you drop to the full view automatically. If there are no groups, the **뷰 전환** drop-down does not appear at all.

---

## 9. Domains

**What** — A domain is a reusable unit that bundles a column's type, default value, and allowed values. Apply it to columns that must follow the same specification across the project, such as 「금액」 (amount) or 「상태코드」 (status code).

**Where** — Editor header **사전·리소스** (Dictionaries & resources) → **도메인** (Domains). The dialog description is **공통 컬럼 타입·기본값·허용값을 재사용 단위로 관리합니다** ("Manage common column types, defaults, and allowed values as reusable units").

**How — define** — Click **도메인 추가** (Add domain) and enter **이름** (Name) and **논리 타입** (Logical type) (for example, `DECIMAL(15)`, `INT UNSIGNED`). Both are required, and if either is empty, **저장** (Save) is locked. If you enter **분류** (Category), the list is grouped by that category (empty means **미분류**, Uncategorized). **방언별 물리 타입 (선택)** (Physical type per dialect, optional) has four fields, **PostgreSQL**, **MySQL·MariaDB**, **Oracle**, and **MSSQL**, for setting a type per dialect. If they are empty, the logical type is converted automatically for each dialect. Fill in **기본값** (Default), **허용값 (쉼표로 구분)** (Allowed values, comma-separated; for example, `ACTIVE, INACTIVE`), and **설명** (Description), then click **저장** (Save).

**How — apply to a column** — Choose it from the **도메인** (Domain) drop-down in a column row of the edit panel. Once set, that column's **타입** (Type) field is locked and shows the domain's logical type. Switch back to **없음** (None) to type it directly again.

**How — find** — When at least one domain exists, a search box (**이름 검색**, Search by name) appears above the list and finds domains by name (case-insensitive partial match). If nothing matches, **검색 결과가 없습니다** ("No results") appears. The list is split into pages of 50. With two or more pages, **전체 N건** (N total) and **이전 · 1 / 3 · 다음** (Previous · 1 / 3 · Next) appear at the bottom. Category headings show only the categories on that page.

**How — edit and apply everywhere** — Edit with the pencil icon in the list. **A domain does not copy its values; it is always a live reference**, so saving applies the change to every column that uses the domain immediately. If the domain is in use, saving asks for confirmation with **N개 컬럼에 영향을 줍니다. 계속할까요?** ("This affects N columns. Continue?").

**Limits**

- **Delete guard**: a domain in use cannot be deleted. The list shows **사용처 N개** (N usages), and the trash can is locked while it does. Clear the domain from the columns first.
- Three things reach the DDL. The **type** (the dialect's physical type if set, otherwise the converted logical type). The **CHECK constraint** (`CHECK (column IN (…))` if there are allowed values, and `CHECK (column >= 0)` if the logical type is unsigned and the dialect is not MySQL; if both apply, both are written). The **default** (the column's own default wins if it has one, otherwise the domain default). The unsigned `CHECK` **is written even when a per-dialect physical type is set**. The override is about the storage form, and the `CHECK` is about the value, so they do not exclude each other.
- Domains are exported to the Excel **도메인정의서** (Domain specification) sheet and can also be registered by upload (→ [section 15](#15-export), [section 16](#16-import)).

### 9.1 Table options (`ENGINE`, `CHARSET`)

**What** — A string appended as is after the closing parenthesis of `CREATE TABLE` when you export DDL.
Like MySQL's `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, it is **a physical deployment setting that the whole
project usually shares in practice**, so it lives in project settings rather than on each table. Every table
gets the same value.

**Where** — Project settings (`/p/:projectId/settings`) → **테이블 옵션** (Table options). It is visible only with
**manage permission**. It is also visible in local mode.

**How** — There are four fields, **PostgreSQL**, **MySQL**, **Oracle**, and **MSSQL**, and a field's value is
appended **only when you export to that dialect**. The value is saved when the field loses focus (click elsewhere
or press Tab). The fields are separate because the syntax differs per dialect. Appending one string to all four
dialects would put MySQL's `ENGINE=` after PostgreSQL DDL, and that DDL would not run at all. Examples: mysql
`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, oracle `TABLESPACE users`, mssql `ON [PRIMARY]`.

**Limits**

- **The value is not validated** (the same policy as the domain's per-dialect physical type). If you write it
  wrong, that dialect's DDL fails, and the failure is immediately visible.
- ⚠️ **Do not write `COMMENT=`.** Options are written **before** the table comment, so when you import that DDL
  again, the `COMMENT=` you wrote here is read as the table comment.
- If you leave a field empty, nothing is appended. A project that does not use options gets byte-for-byte
  identical output.
- Options are not written to DBML (DBML has no syntax for table options).
- You can also fill these values **when you import** DDL (→ [section 16](#16-import)).

---

## 10. Naming system (word and term dictionary)

**What** — A dictionary for generating physical names from logical names automatically. A **word** is the standard abbreviation of a single word, such as "고객" (customer) → `CUST`. A **term** is the standard physical name for a **whole logical name**, such as "고객주문번호" (customer order number) → `CUST_ORD_NO`, and can also set a default domain.

**Where** — Editor header **사전·리소스** (Dictionaries & resources) → **단어·용어 사전** (Word and term dictionary). The title is **단어·용어 사전**, and there are four tabs: **단어** (Words), **용어** (Terms), **미등록 항목** (Unregistered items), and **가져오기** (Import).

**How — physical name generation rules**

1. **An exact term match comes first.** If a term is exactly equal to the whole logical name, its physical name is used. If the term has a domain, the column's domain is filled in as well.
2. Otherwise, the name is **split by longest match against the word dictionary**. The logical name is read from the start, the longest word is matched first, and the abbreviations of the words are joined with the separator `_` and uppercased.
3. A part that matches no word is left out of the result and reported as an **unregistered word**.

The same rules apply when you enter a logical name in the edit panel, when you click ↑ (**물리명 채우기**, Fill physical name) in the logical name field, when autocomplete suggestions are produced while you type, when a junction table name is built, and when a logical name is restored from a physical name during DDL import.

**How — register** — **단어** (Words) tab → **단어 추가** (Add word) → **약어** (Abbreviation) and **논리명** (Logical name) (required), **영문명** (English name) and **설명** (Description) (optional) → **저장** (Save). **용어** (Terms) tab → **용어 추가** (Add term) → **물리명** (Physical name) and **논리명** (Logical name) (required), **도메인** (Domain) and **설명** (Description) (optional) → **저장** (Save). The tab description is **논리명 전체가 완전일치할 때 우선 적용되는 표준 물리명을 관리합니다** ("Manage standard physical names that take priority when the whole logical name matches exactly"). In both lists, each row shows the logical name and physical name (the abbreviation, for words) side by side. Items in use show **사용처 N개** (N usages), and the pencil and trash can edit and delete them. The tab titles carry the total count, as in **단어 (3,280)** and **용어 (13,159)**. The search box above the list is **논리명·약어·영문명 검색** (Search logical name, abbreviation, English name) on the word tab and **논리명·물리명 검색** (Search logical name, physical name) on the term tab (case-insensitive partial match). If nothing matches, **검색 결과가 없습니다** ("No results") appears. The list is split into pages of 50. With two or more pages, **전체 N건** (N total) and **이전 · 1 / 264 · 다음** (Previous · 1 / 264 · Next) appear at the bottom. Clicking **용어 등록** (Register term) in a column row of the edit panel also registers that column's logical name, physical name, and domain as a term.

**How — edit a term and update its usages** — When you edit a term that is already in use, the confirmation **"〈용어〉" 용어를 쓰는 N곳을 함께 갱신할까요?** ("Update the N places that use the term "〈term〉" as well?") appears. It lists what changes, where, and how, and you choose **N곳에 반영** (Apply to N places) or **유지** (Keep). **유지** changes only the term and leaves the usages as they are.

**How — collect and register unregistered items** — The **미등록 항목** (Unregistered items) tab (its count is the sum of the candidates in both directions; with 0, no parentheses appear) contains **two sub-tabs, one per direction**. The default is **논리명 → 약어** (Logical name → abbreviation), and each sub-tab name carries that direction's count in parentheses. **논리명 → 약어** lists words that were not in the dictionary when table and column logical names were split. Enter an abbreviation in the **약어** (Abbreviation) field to the right of each candidate and click **일괄 등록** (Register all) to register **only the items with an abbreviation entered**, in a single edit. **물리명 → 논리명** (Physical name → logical name) is the reverse. It lists abbreviations that were not in the dictionary when physical names were split. Enter a logical name in the **논리명** (Logical name) field to the right of each candidate and click the same **일괄 등록** to register **only the items with a logical name entered**. Because you type the names yourself on this side, **a name that already exists in the dictionary, or that overlaps another in the list**, shows **사전에 이미 있습니다** ("Already in the dictionary") or **위 항목과 겹칩니다** ("Overlaps an item above") on that row, and the item is left out of the registration. Switching sub-tabs clears the values you were entering (the candidate sets are entirely different). Either way, the result is added to the same word dictionary.

> If you only want to register one item, you do not need to come to this screen. You can register it in place from the **미등록** (Unregistered) chips under the names in the edit panel (→ [section 5](#5-tables-and-columns)).

**Limits**

- Dictionaries are **per project**. Standard dictionaries at the organization or global level come in only when you import them as shared resources (→ [section 13](#13-shared-resources)).
- Automatic physical name generation happens when focus moves elsewhere (blur), **only if the physical name is empty**. If it already has a value, editing the logical name leaves the physical name as it is. Press **Enter** or click **↑ in the logical name field** to overwrite it.
- Automatic logical name restoration is symmetric. If it already has a value, editing the physical name leaves the logical name as it is, and **Enter** or **↓ in the physical name field** overwrites it. If the physical name cannot be fully split into dictionary abbreviations (if even one abbreviation is not in the dictionary), nothing is filled in, and the arrow shows the reason in a toast.
- Autocomplete uses **prefix match** only. Infix matching and initial-consonant search are not available yet.
- **A column's domain is set automatically only if its physical name was empty.** If you change the logical name of a column whose physical name is already filled to a term name, the domain stays as it is. Choose it directly from the **도메인** drop-down.
- When you register from a **미등록** chip on the physical name side, **the abbreviation is fixed to that chip**. To use a different abbreviation, register it on the dictionary screen.
- If a term and the actual physical name diverge, the model check catches it as **용어 불일치** (Term mismatch) (→ [section 12](#12-model-check)).

**How — table physical name format**

**What** — Composes a table's final physical name as "prefix + the part you enter". If you write `TB_{그룹별칭}_{물리명}`, a table whose group alias is `MBR` and whose physical name is `ORD` is written to DDL, DBML, and Excel as `TB_MBR_ORD`. **If you leave it empty, the physical name you entered is used as is (the default).**

**Where** — Project settings (`/p/:projectId/settings`) → **명명 규칙** (Naming rules) → **테이블 물리명 형식** (Table physical name format). It is visible only with **manage permission**. Below the field are the list of available variables and a **preview**. It shows immediately the result of applying the format to one of the current project's tables (with no tables, it shows a hypothetical example). The value is saved when the field loses focus (click elsewhere or press Tab).

| Variable | Value |
|---|---|
| `{그룹별칭}` (group alias) | The alias of the table's group (entered in the group panel). Empty if there is no group or the alias is empty |
| `{그룹명}` (group name) | The name of the table's group |
| `{물리명}` (physical name) | The table physical name entered in the edit panel |
| `{논리명}` (logical name) | The table logical name |
| `{커스텀:항목이름}` (custom:field name) | The value of the **table** custom field with that name (if none, the definition's default; if that is also missing, empty) |

- **Underscores around an empty slot collapse.** A table without a group comes out as `TB_ORD`, not `TB__ORD`.
- **⚠️ The collapsing rule has changed.** If you were using a format with a literal after a variable, such as `TB_{그룹별칭}_LOG`, the result for a table with an empty alias changes from `TB_` to **`TB_LOG`** (what is removed has narrowed from "the whole trailing literal" to "only the underscore"). **The table names in DDL exported earlier and DDL exported now differ.** If you were using such a format, check it once. Separators other than underscores (`TB_{그룹별칭}-LOG`) remain (`TB_-LOG`).
- **A variable that does not exist leaves its slot empty.** A typo (`{그룹별칙}`) does not break the screen, and the preview shows that slot empty, so you notice it immediately.
- **Under the table name fields in the edit panel, the composed result appears as `물리 → TB_MBR_ORD`.** It does not appear when the format is empty, and **it does not appear for columns** (columns have no format). If a logical name format is also set, one more line, `논리 → …`, appears below it.

**Where it applies**

| Place | Value |
|---|---|
| DDL (`CREATE TABLE`, foreign keys, indexes, comments) · DBML · the physical name column of the Excel specification | **The composed name** |
| Model check: duplicate physical name (table), length exceeded, reserved word | **The composed name** |
| Model check: term mismatch | The physical name you entered |
| Edit panel fields · sidebar tree · copy · CLI files | The physical name you entered |

**Limits**

- **Only the part you enter is saved.** The prefix is not saved, so when you change the format or move the table to another group, the final name follows immediately.
- Even if the physical name is empty, the table is written to the DDL if there is a prefix (`TB_MBR`). The model check's **필수 값 누락** (Missing required value) still appears, as a reminder to fill it in.
- **The round trip is closed.** The **first line of exported DDL and DBML carries a single comment, `-- erdd:v2 {…}` (`// erdd:v2 …` in DBML)**, that records which final name came from which part. If you import that file again as is, `ORD` goes into the physical name field. You do not need to remove the prefix by hand.
- **That line carries groups too.** It records **which group each table belonged to**, along with that group's **alias, color, and comment**. When it is read back, the groups are recreated and the tables go into them. If a group with the same name already exists, **that group is used and its existing alias, color, and comment are not overwritten**. If the header's alias differs from the existing one, ERDD reports **머릿말의 별칭 … 과 기존 그룹의 별칭 … 가 달라 기존 값을 유지합니다** ("The header's alias … differs from the existing group's alias …, so the existing value is kept"). **Group screen coordinates are not restored** (they are laid out again the first time you open the group view).
- **⚠️ If you use groups, the comment appears on the first line of the DDL even without a format.** Previously, a project that did not use formats got byte-for-byte identical output. Now the line is written **if even one of the exported tables belongs to a group**. (Even if the project has groups, **if you narrow the scope and export only tables without a group**, the line is not written. The header looks only at the exported list.) So **DDL exported earlier and DDL exported now differ by that one line.** If you keep outputs under version control and compare them as is, this will trip once (it is an added header, not a content difference). In **a project that uses neither groups nor formats**, the line is still not written.
- An `erdd:v1` header exported earlier is **still read**. However, v1 has no place for groups, so only the physical and logical names are restored, not the groups.
- **⚠️ In two cases, however, the old behavior applies (the prefix gets baked into the physical name).**
  - You imported **after removing the `-- erdd:v2 …` comment on the first line** of the file
  - You **pasted a single `CREATE TABLE` statement cut out of the file**. The header does not come along, so there is no table of names

  In these cases, `TB_MBR_ORD` becomes the whole physical name, and exporting again gives `TB_MBR_TB_MBR_ORD`. Remove the prefix by hand after importing. The same applies to DDL from someone else (a file we did not export). **Groups cannot be restored either.** The group assignments and their alias, color, and comment are all lost. DBML is the only exception. If you paste the `TableGroup` blocks along with it, **the group assignments, colors, and comments those blocks describe are restored, and only the aliases are lost** (DBML's `TableGroup` block has no place to write an alias).

**How — table logical name format**

**What** — Composes a table's final logical name. If you write `{그룹명}_{논리명}`, a table whose group name is `회원관리` (member management) and whose logical name is `주문` (order) is written to DDL comments, DBML notes, and the Excel logical name column as `회원관리_주문`. **If you leave it empty, the logical name you entered is used as is (the default).**

**Where** — Project settings (`/p/:projectId/settings`) → **명명 규칙** (Naming rules) → **테이블 논리명 형식** (Table logical name format). It is right below the physical name format field. It is visible only with **manage permission**, has the same kind of preview, and is saved when the field loses focus.

**The available variables and the empty-slot collapsing rule are exactly the same as for the physical name format** (the table above).

**Where it applies**

| Place | Value |
|---|---|
| DDL comments (`COMMENT ON TABLE`, MySQL inline) · DBML note · the logical name column of the Excel specification | **The composed name** |
| Term dictionary lookup · **미등록 단어** (Unregistered word) chips · logical name separator warning | The logical name you entered |
| Automatic physical name generation | The logical name you entered |
| Edit panel fields · sidebar tree · canvas · CLI files | The logical name you entered |

**Limits**

- **⚠️ It is for outputs only.** Dictionary lookup, word checks, and physical name generation look at **the logical name you entered** as is. That way you only need to register `주문` in the dictionary, and changing the format does not put the dictionary out of step.
- If you use `{물리명}` in the logical name format, it gets **the value before the physical name format is applied** (the two formats do not feed into each other).
- The check that omits the comment when the logical and physical names are equal uses **the composed names on both sides**.
- **The round trip also closes for logical names.** The header records the logical name part too, so reading it back brings in `주문`. **The header takes priority** over the composed logical name in the comment (`회원관리_주문`) (the description is taken from the comment as is). Without a header, the whole composed logical name goes into the logical name field, the same as for physical names.
- The **논리명** (Logical name) column of the word and term dictionary sheets belongs to the words and terms, so it is not composed.
- Column logical names and column physical names have no format.

---

## 11. Custom fields

**What** — Adds project-specific management fields to tables and columns. You create fields that the standard model does not have, such as "개인정보여부" (contains personal data) or "암호화방식" (encryption method).

**Where** — Define them in the editor header **사전·리소스** (Dictionaries & resources) → **커스텀 항목** (Custom fields). Enter values in the dashed **커스텀 항목** box that appears in the table area of the edit panel and in each column row.

**How — define** — **커스텀 항목** → **항목 추가** (Add field) → **이름** (Name) (required) → choose **적용 대상** (Applies to: table/column) and **타입** (Type). If you enter **기본값** (Default), that value is used for targets without a value. If you turn on **필수 (미입력 시 경고)** (Required, warn when empty), targets with an empty value get a warning. Finish with **저장** (Save). When at least one field exists, a search box (**이름 검색**, Search by name) appears above the list, and the list is split into pages of 50. **The order (▲▼) buttons are locked while you search**, because moving an item in a filtered list would swap it with items you cannot see.

| Type | Shown on screen as | Value input |
|---|---|---|
| text | **텍스트** (Text) | Free text |
| boolean | **불리언** (Boolean) | Checkbox |
| select | **선택형** (Select) | Drop-down. **선택지 (쉼표로 구분)** (Options, comma-separated) needs at least one option |

**How — enter values** — Select a table or column to see the **커스텀 항목** box. If a required field is empty, a **필수** (Required) mark appears next to the box title and `*` after the field name. To clear a select value, choose **선택 안 함** (None).

**Limits**

- **The type and target cannot be changed after creation**: **타입과 적용 대상은 변경할 수 없습니다. 바꾸려면 삭제 후 다시 만드세요.** ("The type and target cannot be changed. To change them, delete the field and create it again."). A boolean always has a value, so it cannot be required (**불리언은 항상 값이 있으므로 필수로 지정할 수 없습니다.**, "A boolean always has a value, so it cannot be required.").
- A select default must be one of the options, and a boolean default must be `true`/`false`. Otherwise saving is locked and the reason appears in red.
- When you remove an option that is in use somewhere, ERDD asks **삭제하는 선택지를 N곳에서 사용 중입니다. 값은 유지됩니다. 계속할까요?** ("The option you are removing is used in N places. The values are kept. Continue?"). The values stay and appear disabled in the drop-down as **〈값〉 (삭제된 선택지)** (〈value〉 (deleted option)). Deleting the field itself deletes the entered values too: **"〈이름〉"을(를) 삭제하면 입력된 값 N건도 함께 삭제됩니다. 계속할까요?** ("Deleting "〈name〉" also deletes N entered values. Continue?").
- The order you set with the up and down arrows in the list becomes the column order in the edit panel and the Excel specification.

---

## 12. Model check

**What** — Scans the whole model and collects naming rule violations, structural mismatches, and missing required values.

**Where** — **모델 검사** (Model check) in the editor header. When there are warnings, the count is added, as in **모델 검사 (N)**. The same warnings appear as triangle badges on canvas nodes and in the edit panel, and hovering shows the details.

**How** — Click **모델 검사** to see the warnings grouped by kind. Click an item to close the dialog and select the table or relationship (a column warning moves you to the table that column belongs to). With no warnings, **경고가 없습니다. 명명이 규칙에 부합합니다.** ("No warnings. Names follow the rules.") appears.

**All warning kinds**

| Shown on screen as | Grade | What it means | How to resolve it |
|---|---|---|---|
| **물리명 중복(컬럼)** (Duplicate physical name, column) | Error | Two or more columns in the same table have the same physical name | Change one of the physical names |
| **물리명 중복(테이블)** (Duplicate physical name, table) | Error | Two or more tables have the same physical name | Change one of the table physical names |
| **매핑 불완전** (Incomplete mapping) | Warning | The number of parent primary key columns differs from the number of column mappings in the relationship | Align the parent PK or create the relationship again |
| **타입 불일치** (Type mismatch) | Warning | Mapped parent and child columns have different types | Match one type (or domain) to the other |
| **미등록 단어** (Unregistered word) | Warning | The logical name contains a part that is not in the word dictionary | Register it right away from the **미등록** chip in the edit panel, or collect and register it under **논리명 → 약어** in the dictionary's **미등록 항목** tab |
| **용어 불일치** (Term mismatch) | Warning | A term exactly matches the logical name, but the physical name differs from that standard | Rebuild it with ↑ in the logical name field, or fix the term |
| **논리명 구분자 없음** (No logical name separator) | Warning | The logical name splits into two or more words but has no underscore separator | Change it to the form the message suggests (「회원_주문」), or turn off **논리명을 밑줄로 구분** in project settings |
| **길이 초과** (Length exceeded) | Warning | The physical name exceeds the maximum length (30 bytes by default) | Use shorter abbreviations or shorten the physical name |
| **예약어** (Reserved word) | Warning | The physical name is a reserved word in one of the project's target dialects | Change the physical name |
| **필수 항목 미입력** (Required field empty) | Warning | A custom field marked required is empty | Fill in the value or remove the required setting |
| **필수 값 누락** (Missing required value) | Warning | A **standard field** (not a custom field) is empty: a table's logical or physical name, or a column's logical name, physical name, or type | Fill in the value |

- Only the two duplicate physical name kinds are **errors** (red circle icon). The rest are warnings (yellow triangle).
- **물리명 중복(테이블)**, **길이 초과**, and **예약어** are judged **by the composed final name in a project with a table physical name format**. The same name in different groups is not a duplicate, and a name that exceeds the length once the prefix is added is caught (→ [section 10](#10-naming-system-word-and-term-dictionary)).
- **길이 초과** counts bytes, so Korean physical names reach the limit much sooner than their character count suggests.
- **예약어** checks only the dialects chosen when the project was created. Reserved words of DBs not in that list are not caught.
- **매핑 불완전** and **타입 불일치** are reported at most once per relationship.
- A failed check does not block saving or exporting. Only model integrity violations actually block anything. In that case the edit itself is rejected and the reason appears in a toast.

---

## 13. Shared resources

> **Not available in local mode.** There are no libraries, promotions, or promotion requests (→ [local mode manual 4.2](./local-guide.md#42-which-chapters-of-the-user-guide-apply)).

> **Exchanging files** — Exporting and importing libraries as files is covered in [Library management in section 19](#library-management).

**What** — A way to keep standard **words, terms, domains, and custom fields** outside any project and share them across many projects. Libraries come in two tiers, **global** (the whole service) and **organization**, and what the model actually references is always **a copy made in the project**. There are two directions: **import (resync)** (library → project) and **promotion** (project → library, or a **request** if you lack permission).

> **The CLI can do this too.** Projects edited as files do the same with `erdd dict pull` (import, resync), `erdd dict push` (promotion, promotion request), and `erdd dict requests` (your requests and processing notes). Approvals and request cancellation happen on this screen (→ [CLI manual 6.11](./cli-guide.md#611-erdd-dict--shared-dictionaries)).

**Where** — On the project side, it is editor header **사전·리소스** (Dictionaries & resources) → **공용 리소스** (Shared resources), with two tabs: **가져오기** (Import) and **조직으로 승격** (Promote to organization). The screens where you create libraries and add items are **조직 공용 리소스** (Organization shared resources) on the organization details screen and **전역 공용 리소스** (Global shared resources) on `/admin`. Promotion requests are approved in the **승격 요청** (Promotion requests) section of the organization details screen.

### Import (resync)

1. **공용 리소스** → **가져오기** (Import) → choose a library on the left (it shows **전역** (Global) or **조직** (Organization) and the item count).
2. The items on the right are split into three areas.

| Area | Meaning | Default selection |
|---|---|---|
| **신규 추가** (New) | Items the project does not have yet | Selected. Cleared if the same name already exists (**이름 중복**, Duplicate name badge) |
| **자동 갱신** (Auto update) | Items the project has not touched since importing, but whose source changed | Selected |
| **충돌** (Conflict) | Items changed both in the project and in the source | **보류** (Defer) |

Each area has a search box (**논리명·물리명 검색**, Search logical name, physical name) and paging (50 per page), and each row shows the kind, logical name, and physical name (the abbreviation, for words). Checks are kept when you change pages or search.

3. For a conflicting item, each field shows **현재 〈값〉 → 원본 〈값〉** (current 〈value〉 → source 〈value〉). Choose one of three. **원본 반영** (Apply source) overwrites with the source value. **프로젝트 유지** (Keep project) leaves the content as it is and **records that you reviewed this change** (it does not appear again). **보류** (Defer) records nothing, so it appears again next time.
4. Process items in bulk with **모두 선택** (Select all) / **모두 해제** (Clear all) per area (for conflicts, **모두 원본 반영** Apply source to all / **모두 프로젝트 유지** Keep project for all). These buttons apply **to the whole area, not the visible page or search results**. While you search or when there are several pages, **구역 전체 N건에 적용** (Applies to all N in this area) appears next to the button.
5. Check the number of items left untouched in the **유지** (Unchanged) section below: **최신 상태 N건 · 프로젝트 자체 항목 N건** (N up to date · N project-only items). If items were deleted in the source, **원본에서 삭제된 항목 N건 — 프로젝트 사본은 그대로 둡니다.** ("N items deleted in the source. The project copies are kept.") appears.
6. Click **적용** (Apply). The right side shows **처리 대상 N건** (N items to process).

**Limits** — The first import is the same as "a resync where every item is new", so there is no separate menu. Applying more than 5,000 items is sent in several batches. The **적용** button is locked and shows progress, as in **적용 중… 2 / 4** (Applying… 2 / 4). However many batches it takes, the apply is a single edit, so **one undo reverts all of it** (the version history records each batch separately, as in **… (1/4)**). If a middle batch fails, it stops there and shows **4개 묶음 중 2개를 적용했고 나머지는 적용하지 못했습니다 — 〈오류〉** ("Applied 2 of 4 batches and could not apply the rest: 〈error〉"). The earlier batches are already applied and the undo history is cleared. To roll back, return to an earlier snapshot on the versions (history) screen. Deleting an item in the source does not delete the project copy.

### Promotion and promotion requests

1. **공용 리소스** → **조직으로 승격** (Promote to organization) → choose the library to promote to.
2. The items appear in three areas.

| Area | Meaning | Default selection |
|---|---|---|
| **신규 추가** (New) | Items the library does not have | Selected |
| **원본 갱신** (Update source) | Pushes this project's values to library items it is already linked to | Selected. **Cleared** for items whose source changed after import (badge) |
| **동명 발견** (Same name found) | The library has a different item with the same name | **Cleared**, because a person needs to check it |

Each area has a search box and paging, and **모두 선택** / **모두 해제** apply to the whole area (the same as import, and the same as the approver's review window).

**동명 발견** comes with **대상 라이브러리에 같은 이름의 항목이 있습니다. 선택하면 그 항목을 이 프로젝트의 값으로 갱신하고 연결합니다.** ("The target library has an item with the same name. If you select it, that item is updated with this project's value and linked."). If you promote a term that references a domain without also choosing that domain, it gets a **도메인 연결 비움** (Domain link cleared) badge.

**Items whose source changed after import** (someone else edited that library item after the project last imported) appear in the **원본 갱신** area with the badge **원본이 더 새롭습니다 — 먼저 가져오기(재동기화)로 받으세요** ("The source is newer. Get it with import (resync) first") and are cleared by default. This project's value is older than that person's new value, so promoting it as is would revert the edited source to the old value. If you resync on the **가져오기** tab first, untouched items are aligned to the source values, and items also changed in the project appear as conflicts. Choose **프로젝트 유지** (Keep project) there, then promote, and the item goes up without the badge. You can also check it and promote it directly, but that overwrites the source's new value.

3. **If you have write permission**, the button is **승격** (Promote). Clicking it promotes the items immediately, and the result appears in a toast: **추가 N건 · 갱신 N건을 올렸습니다** ("Promoted N added · N updated"). More than 5,000 items are promoted in parts, with progress on the button, as in **적용 중… 1 / 2** (Applying… 1 / 2), and the results are combined into one toast. If it fails partway, **N건 중 M건 승격했습니다 — 〈오류〉** ("Promoted M of N: 〈error〉") appears and the list reloads (items promoted before the failure remain).
4. **If you do not have permission**, the button is **승격 요청** (Request promotion), and a **요청 메모 (선택)** (Request note, optional) field appears above it. A request leaves the library as it is and only adds a request row. One request can include up to 50,000 items. Beyond that, **한 번에 요청할 수 있는 항목은 50,000건까지입니다. 나눠 선택해 주세요.** ("You can request up to 50,000 items at once. Split your selection.") appears and nothing is sent. Items already applied or deleted are left out automatically, and the count is reported. Your pending requests appear in the **대기 중인 요청** (Pending requests) box at the top of the same tab, with requester, count, and note, and you can close one with **요청 취소** (Cancel request).

**How — approve (organization admin)**

1. A **승격 요청 N건** (N promotion requests) badge appears in the top bar. **This badge is the only way a request reaches the approver** (there are no email notifications). It refreshes every 60 seconds. If you belong to one organization, it takes you to that organization; if several, to the home screen. The organization cards on the home screen carry the same badge.
2. In the **승격 요청** (Promotion requests) section of the organization details screen, view the list with the status filter (**대기 중** Pending, **승인됨** Approved, **반려됨** Rejected, **취소됨** Cancelled). The table shows project, library, requester, items, and note.
3. Click **검토** (Review) on a pending row to open the **승격 요청 검토 — 〈프로젝트명〉** (Review promotion request: 〈project name〉) dialog. The server computes the plan at that moment.
4. Choose the items to promote and leave a **처리 메모 (선택)** (Processing note, optional). The button changes with the number of items you choose: **N건 승격** (Promote N) if you choose at least one, and **반려** (Reject) if you choose none. **Rejecting closes the request.**
   If the library item changed after the requester last received it (before or after the request), the badge **원본이 요청자가 받은 버전보다 새롭습니다 — 승인하면 최신 원본을 요청자의 값으로 되돌립니다** ("The source is newer than the version the requester received. Approving reverts the latest source to the requester's value") appears and the item is cleared by default. It means the value the requester saw is older than the latest source. Checking and approving it overwrites the latest source, so usually you approve without it, or use the processing note to ask the requester to resync and request again.

**Limits**

- Promotion requests target **organization libraries only**. For global libraries, someone with write permission (service role `admin`) promotes directly.
- A request closes once it is processed. Processed rows are a read-only history and have no **검토** button. The approver's processing note can be seen on the web only in the **처리 메모** (Processing note) column of this list (it is not on the requester's promotion tab; the CLI's `erdd dict requests` shows it). Rejection reasons go in the same column.
- Deleting a library deletes its items too (**"〈이름〉"을(를) 삭제하면 항목 N개도 함께 삭제됩니다. 계속할까요?**, "Deleting "〈name〉" also deletes its N items. Continue?"). Deleting one item asks **"〈이름〉"을(를) 삭제할까요? 이미 가져간 프로젝트의 사본은 그대로 남습니다.** ("Delete "〈name〉"? Copies already imported into projects remain.").
- Items carry a version number (`v1`, `v2`…), and the resync and promotion screens show it as **v2 → v3**.

---

## 14. Versions (history, snapshots, comparison)

> **Different in local mode.** There is no **이력** (History) tab (git commits take its place), and snapshots are stored in `erdd/snapshots/` and **committed**. You cannot create a snapshot while there are unsaved edits, and **복원** (Restore) only reverts the screen, so you must **저장** (Save) to write it to the files (→ [local mode manual section 6](./local-guide.md#6-snapshots)). Local mode also has a **변경 기록** (Change records) tab (→ [local mode manual 5.6](./local-guide.md#56-change-records--the-edit-history-for-writing-migrations)).

**What** — One screen handles the edit history (revisions), named points in time (snapshots), and comparisons between two points in time.

**Where** — **버전** (Versions) in the editor header. It has three tabs: **스냅샷** (Snapshots), **이력** (History), and **비교** (Compare).

**How — history** — The **이력** tab lists edits, newest first. Each line shows **#〈번호〉 〈요약〉** (#〈number〉 〈summary〉) with the actor and time, and a source badge on the right: `web` (web UI), `cli` (CLI), or `system` (system operations such as restore). If there are more, **더 보기** (Show more) loads them.

**How — snapshots** — On the **스냅샷** tab, enter **이름** (Name) (for example, 「배포 전 백업」, "backup before release") and click **스냅샷 만들기** (Create snapshot). Click an item in the list to expand its summary (the table count and the first 5 physical names). **복원** (Restore) asks **"〈이름〉" 스냅샷으로 복원할까요? 현재 편집 중인 내용이 대체됩니다.** ("Restore to the snapshot "〈name〉"? What you are editing now will be replaced.") and then reverts to that point. The dialog closes and the screen reloads. **삭제** (Delete) asks **"〈이름〉" 스냅샷을 삭제할까요?** ("Delete the snapshot "〈name〉"?").

**How — compare**

1. In the **기준** (Base) and **비교** (Compare) drop-downs on the **비교** tab, choose **현재** (Current, the model you are editing) or a snapshot for each. The default is base = the latest snapshot, compare = **현재**.
2. Below appear **추가 N · 삭제 N · 변경 N** (N added · N deleted · N changed) and the list of changes. Each line shows the kind (table, column, relationship, index, group, domain, word, term, custom field, note), the target name, and the change type (added/deleted/changed), and changed properties expand as **이전값 → 이후값** (before → after). If a target name looks like a link, click it to go to that entity.
3. **변경분 정의서** (Change specification) downloads `erdd_변경분정의서.xlsx`, which contains only the differences. The top of the sheet reads **기준: 〈…〉 · 비교: 〈…〉** (Base: 〈…〉 · Compare: 〈…〉).

**Limits**

- **Only people who can manage the project** can restore and delete snapshots (Org Owner/Admin or Project Admin). Others do not see the **복원** and **삭제** buttons.
- A restore is recorded in the history with the `system` source, and the restore itself cannot be undone. The undo history is cleared.
- When you create a snapshot, you can enter only a name. The description column in the list has no value and shows **설명 없음** (No description).
- Comparing needs at least one snapshot. Without one, **비교하려면 스냅샷이 하나 이상 필요합니다. 아직 스냅샷이 없습니다** ("Comparing needs at least one snapshot. There are no snapshots yet") appears. Targets that are not in the current model (deleted tables and the like) cannot be clicked to navigate.
- The history keeps only edit summaries. There is no screen that shows the details of what changed.

---

## 15. Export

**What** — Exports the design as executable DDL, DBML for publishing documentation, an image for sharing, and an Excel specification for submission. It is a read-only feature that does not change the model.

**Where** — Editor header **파일** (File) → **내보내기** (Export). It has four tabs: **DDL**, **DBML**, **이미지** (Image), and **Excel**.

### DDL

1. Choose **방언** (Dialect): **PostgreSQL**, **MySQL·MariaDB**, **Oracle**, or **MSSQL**.
2. Choose **범위** (Scope): **전체** (All) or one group from the group drop-down. If you open the dialog while viewing a group view, that group is selected by default.
3. The result appears immediately in **DDL 미리보기** (DDL preview).
4. Copy it to the clipboard with **복사** (Copy), or get `erdd_〈방언〉.sql` with **다운로드** (Download).

| Part | Description |
|---|---|
| `CREATE TABLE` | Column type, NOT NULL, default, auto-increment (dialect syntax), primary key. **For MySQL·MariaDB, nullable `TIMESTAMP` columns are written with `NULL` explicitly.** This prevents the column from becoming `NOT NULL` on its own, depending on server settings, and from changing to the current time every time the row is updated |
| CHECK constraints | `column IN (…)` for columns whose domain has allowed values |
| Foreign keys | `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY`. A 1:1 relationship also gets a UNIQUE constraint |
| Indexes | `CREATE [UNIQUE] INDEX`, including the sort direction of each column |
| Comments | Table and column comments. `COMMENT ON` for PostgreSQL and Oracle, extended properties for MSSQL, inline in `CREATE TABLE` for MySQL |

**Table names** — If the project settings' **테이블 물리명 형식** (Table physical name format) is not empty, `CREATE TABLE`, foreign keys, indexes, and comments **all** use the composed name (→ [section 10](#10-naming-system-word-and-term-dictionary)).

**Limits** — A table with no columns is left out, and **〈테이블〉: 컬럼이 없어 내보내기에서 제외됨** ("〈table〉: excluded from export because it has no columns") appears under **DDL 경고** (DDL warnings). **A table whose physical name is empty, or a table with a column whose physical name is empty, is left out the same way**, with **〈테이블 또는 논리명〉: 물리명이 비어 있어 내보내기에서 제외됨** ("〈table or logical name〉: excluded from export because the physical name is empty"), because no identifier can be built. Types whose dialect conversion is uncertain also produce warnings, and types that cannot be interpreted are written as entered. Relationships and indexes that connect to tables outside the scope are left out as well.

### DBML

The **DBML** tab produces DBML that dbdocs and dbdiagram.io read. Its main use is **publishing documentation with dbdocs**.

1. Choose **방언** (Dialect) and **범위** (Scope). **They share the same selection as the DDL tab** (the selection stays when you switch tabs). Type interpretation is also the same as DDL (including the domain's per-dialect mapping).
2. The result appears immediately in **DBML 미리보기** (DBML preview).
3. Copy it to the clipboard with **복사** (Copy), or get `erdd_〈방언〉.dbml` with **다운로드** (Download).

| Part | Description |
|---|---|
| `Project` | The project name and `database_type` (the chosen dialect). Written only when there is a project name |
| `Table` | `headercolor` if it belongs to a group, and 「논리명 - 설명」 (logical name - description) in `note` |
| Column settings | `pk` (single primary key) · `increment` · `not null` · `null` · `default` · `note`. `null` is added **only to nullable `TIMESTAMP` columns in the MySQL·MariaDB dialect**, and never to primary key columns |
| `indexes` block | Indexes (name, `unique`) and the **composite primary key** (`[pk]`) |
| `TableGroup` | The group name, `color`, and the list of tables in it |
| `Ref` | Relationships. `>` for 1:N, `-` for 1:1. Composite keys are wrapped in parentheses, and **only relationships you named** carry a name |

**Custom field values** are appended to the note as JSON, for example `회원 - 회원 기본정보 {"보안등급":"2"}`. The keys are **the names of the custom field definitions**, and fields with empty values are not written.

**Limits** — Table selection and warnings are exactly the same as DDL (tables with zero columns or an empty physical name are left out). Domain allowed values are not written as `enum`, because there is no way to turn them back into a domain when reading, so they would become "a type with only a name left". Notes, color areas, and coordinates are not included in DBML.

### Image

On the **이미지** (Image) tab, choose **PNG** or **SVG** and click **다운로드** (Download). **현재 화면(뷰·보기 모드)이 그대로 저장됩니다** ("The current screen, view and view mode, is saved as is"). The full view or group view and the logical, physical, or mixed setting are reflected. However, regardless of the current pan and zoom, the image includes **every node**. With no nodes, it fails with **내보낼 노드가 없습니다** ("There are no nodes to export"). You cannot choose a separate image scope. To narrow it, switch to a group view and then export.

### Excel specification

On the **Excel** tab, choose **범위** (Scope: **전체** All or a group), turn on the sheets to export under **시트** (Sheets) (all are on by default), and click **다운로드** (Download) to get `erdd_정의서.xlsx` (or `erdd_정의서_〈그룹명〉.xlsx` if you chose a group). The workbook order is as follows.

| Sheet | Columns |
|---|---|
| **테이블 목록** (Table list) | Group · logical name · physical name · description (+ table custom fields) |
| **테이블정의서** (Table specification) | Group · table logical name · table physical name · sequence · logical name · physical name · domain · type · PK · NOT NULL · default · description (+ column custom fields) |
| **단어사전** (Word dictionary) | Logical name · abbreviation · English name · description |
| **용어사전** (Term dictionary) | Term · component words · physical name · default domain · description |
| **도메인정의서** (Domain specification) | Name · category · logical type · PostgreSQL · MySQL · Oracle · MSSQL · default · allowed values · description |

The **변경분 정의서** (Change specification) sheet is not in this list. You create it only from the comparison screen (→ [section 14](#14-versions-history-snapshots-comparison)).

**Limits** — **범위는 테이블 목록·테이블정의서에만 적용됩니다. 사전 3종은 항상 전체를 내보냅니다** ("The scope applies only to the table list and table specification. The three dictionaries are always exported in full"). Dictionaries are project-wide assets with no notion of groups. If you turn on no sheets, **다운로드** is locked. Every cell is written as a string, so the leading zeros of a physical name such as `0001` are kept, and the representation is symmetric with the upload parser. Domain allowed values are joined with `, `, so an allowed value that itself contains a comma is not restored exactly when uploaded back (a known limitation).

---

## 16. Import

**What** — Two reverse paths. **Reverse engineering**, which pastes an existing DB's **DDL (or DBML) and turns it back into a model**, and **upload**, which registers dictionaries all at once from **Excel in a fixed template**.

### DDL and DBML import

**Where** — Editor header **파일** (File) → **DDL·DBML 가져오기** (Import DDL/DBML) (the dialog title is the same). Without edit permission, this item is not in the menu.

1. At the top, choose the format: **DDL** (default) or **DBML**. Changing the format resets a dialect you chose manually (each format gives a different auto-detection result).
2. Check **방언** (Dialect). It is detected automatically from the pasted content (for DBML, from `Project { database_type }`), and the matching item is marked **(자동 감지)** (auto-detected). You can change it in the drop-down at any time.
3. Paste into the text area (**CREATE TABLE ... 형태의 DDL을 붙여넣으세요** "Paste DDL in the form CREATE TABLE ..." / **Table "..." { ... } 형태의 DBML을 붙여넣으세요** "Paste DBML in the form Table "..." { ... }").
4. A preview appears immediately: **테이블 N개 · 컬럼 N개 · 관계 N개 · 인덱스 N개** (N tables · N columns · N relationships · N indexes), plus **· 그룹 N개** (· N groups) if the DBML has groups, and **건너뜀 N개 (이름이 겹침: …)** (N skipped (duplicate names: …)) if tables were skipped. What is listed are **the names in the original DDL**, and the warning list below states, per table, what each one collided with (the two differ when the header restored a name).
5. Check the **가져오기 경고** (Import warnings) list.
6. If table options were detected and differ from the project's current value, **a 프로젝트의 테이블 옵션도 갱신 (Also update the project's table options) checkbox** appears (→ "Table options" below). **It is visible only with manage permission.**
7. Click **〈N〉개 테이블 만들기** (Create 〈N〉 tables). Tables, columns, and relationships are applied in a single edit, so one undo reverts them.

**Table options**

From a trailing clause in the DDL such as `) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, only `ENGINE`, `DEFAULT CHARSET`,
and `COLLATE` are extracted and normalized into one line. If tables differ, **the most frequently used value is
adopted** (on a tie, the one that appears first in the DDL). Each table that differs from the adopted value gets one
warning. Per-table values such as the `AUTO_INCREMENT=` start value are discarded, because raising them to the
project setting would change the start value of every table.

The checkbox starts **on if the project's field for that dialect is empty**, and **off if it has a different value**.
This keeps a value you set from being overwritten silently. You can flip it at any time.

⚠️ **Undo is split.** Table creation can be undone, but **the project setting cannot be undone**. Settings are
outside the edit history. The dialog also says so in its text.

**Unsigned**

A notation such as `int unsigned` comes in as the logical type `INT UNSIGNED`. Unsigned attached to anything other
than the three integer types (`SMALLINT`, `INT`, `BIGINT`), such as `decimal(10,2) unsigned`, is **dropped with a
warning**. The integer display width that MySQL 5.7 writes (`int(11)`, `bigint(20)`) is read and discarded. It is a
display-only value, deprecated since 8.0.17.

**Only the parser differs by format.** Dialect selection, preview, warnings, and applying all go through exactly the same path.

**Syntax the parser reads**

| Statement | What it reads |
|---|---|
| `CREATE TABLE` | Column name, original type text (including the `UNSIGNED` suffix and integer display width), `NOT NULL`, `DEFAULT`, auto-increment, inline `PRIMARY KEY`, MySQL inline `COMMENT` |
| The trailing clause of `CREATE TABLE` | `ENGINE`, `DEFAULT CHARSET` (`CHARACTER SET`), `COLLATE` (→ "Table options" above), MySQL table `COMMENT` |
| Constraints inside `CREATE TABLE` | `PRIMARY KEY`, `UNIQUE`, `FOREIGN KEY … REFERENCES` |
| `ALTER TABLE … ADD` | `PRIMARY KEY`, `UNIQUE`, `FOREIGN KEY` |
| `CREATE [UNIQUE] INDEX` | Index name, target table, columns |
| `COMMENT ON` | Table and column comments |

It handles comments (`--`, `/* */`), string literals, quoted identifiers (`"…"`, `` `…` ``, `[…]`), schema prefixes, and the `/` separator in Oracle scripts.

**What the parser cannot do** — Every statement not in the list above is skipped and reported as **〈행〉 〈키워드〉 구문을 건너뛰었습니다** ("〈line〉: skipped 〈keyword〉 statement"). Typical examples are `CHECK` constraints (inline or `ALTER TABLE … ADD CHECK`), `CREATE VIEW`/`SEQUENCE`/`TRIGGER`/`PROCEDURE`/`FUNCTION`, and DML and permission statements such as `GRANT` and `INSERT`. **It does not read the sort direction of index columns either.** Every imported index becomes `ASC`.

**Other limits**

- If a table with the same physical name already exists, it is skipped (**같은 이름의 테이블이 이미 있어 건너뜁니다**, "A table with the same name already exists, so it is skipped"). If the same name appears twice in the DDL, the later one is skipped.
- **Restoring logical names from physical names depends on the dictionary.** If an abbreviation is unknown, **논리명을 복원하지 못했습니다 — 사전에 없는 단어: …** ("Could not restore the logical name. Words not in the dictionary: …") appears. Fill the dictionary first, and the logical names are restored too.
- An unknown type is kept as written (**…를 알지 못해 타입을 그대로 두었습니다**, "… is unknown, so the type was kept as is"). If several interpretations are possible, one is chosen and the alternatives are reported.
- An FK whose referenced table or column cannot be found, and an index or UNIQUE constraint whose table or column cannot be found, are not created, and each leaves a warning.
- An import of more than 5,000 items is sent in several batches. The button changes to **적용 중… 1 / 2** (Applying… 1 / 2) and is locked. However many batches it takes, one undo reverts it, and what happens when a middle batch fails is the same as the limits of [import in section 13](#import-resync).

**What the DBML parser reads** — `Project` (`database_type`), `Table` (alias `as X` is ignored; `headercolor`, `note`), column lines (type + `pk`/`primary key`/`not null`/`null`/`unique`/`increment`/`default:`/`note:`/inline `ref:`), `indexes` blocks (single and composite; `[pk]`, `unique`, `name:`), `Ref` (both line and block forms, with or without a name, `>` `<` `-`, composite keys), `TableGroup` (`color`, `note`), and comments (`//`, `/* */`).

- **`TableGroup` becomes a group.** If a group with the same name already exists, it is used, and **that group's color is not overwritten.** The color is decided in the order `color` → the first member table's `headercolor` → the palette. ⚠️ **If the first-line header has a group with the same name, the header wins.** That group's members, color, and comment are what the header says, and the block's content is not used (in DBML we exported, the two always agree). Only groups that are not in the header are created from blocks.
- **The JSON tail of a note is read back as custom field values.** A name with no definition is discarded with **커스텀 항목 정의가 없어 "〈이름〉" 값을 버렸습니다** ("Discarded the value of "〈name〉" because there is no custom field definition"). Define the custom fields first, and the values come in too.
- Directions are normalized to child → parent (`<` is reversed). `-` becomes a 1:1 relationship and does not create a unique index. A name on a `Ref` survives as the relationship name.
- `Enum` definitions, `sticky note`, `TablePartial`, `<>` (N:M) relationships, and other unknown blocks are skipped with a warning. Backtick expressions in indexes (`` (`id*2`) ``) cannot be resolved to columns either, so they are skipped.
- Domain links and index sort directions do not come back (DBML has no way to express them).

### Excel dictionary import

**Where** — Editor header **사전·리소스** (Dictionaries & resources) → **단어·용어 사전** (Word and term dictionary) → **가져오기** (Import) tab.

1. Get `erdd_사전양식.xlsx` with **양식 다운로드** (Download template). It contains only headers on three sheets, the word dictionary, term dictionary, and domain specification, using the same headers as export.
2. Choose an `.xlsx` file in **Excel 파일 선택** (Choose Excel file). A preview appears as soon as it is read: **〈파일명〉 — 신규 N건 · 중복 N건 · 오류 N행** (〈file name〉: N new · N duplicates · N error rows).
3. In **중복 항목 처리** (Duplicate handling), choose **건너뛰기** (Skip) or **덮어쓰기** (Overwrite). If you choose overwrite, **덮어쓰기는 파일에 있는 아래 컬럼만 갱신하고 나머지 값은 그대로 둡니다** ("Overwrite updates only the columns below that are in the file and leaves other values as they are") appears, along with the recognized columns per sheet.
4. Errors and warnings appear with the sheet and row number (up to 20, with the rest as **외 N건**, N more).
5. Check **적용 대상 N건** (N items to apply) and click **가져오기 실행** (Run import).

**Limits** — The whole dictionary goes out as a single edit, so one undo reverts it. More than 5,000 items are sent in several batches, with progress on the button, as in **적용 중… 2 / 4** (Applying… 2 / 4) (what happens when a middle batch fails is the same as the limits of [import in section 13](#import-resync)). If the file content already matches the dictionary, **파일 내용이 현재 사전과 같아 바뀐 항목이 없습니다** ("The file matches the current dictionary, so nothing changed") appears. If there are 0 items to apply, the button is locked. While it runs, the button and file selection are both locked. If it fails, the preview remains so you can try again as is.

---

## 17. Real-time co-editing

> **Not available in local mode.** There are no participant indicators or cursors. Local mode assumes one person is working (→ [local mode manual 4.6](./local-guide.md#46-opening-several-tabs)).

**What** — Several people can open and edit the same project at the same time. Others' changes appear on your screen immediately, and you can see who is looking at what.

**Where** — There is no separate screen. You connect automatically when you enter the editor. The avatars of connected users are in the **함께 보는 사용자** (Users viewing together) area at the right of the header (to the left of **버전**).

**How — what you see**

- **Avatars of connected users** — The first letter of the name of each other person viewing the same project appears as a round badge in a fixed color per person. Up to 3 are shown, and the rest are combined as **+N**. Hovering shows the name. You yourself are not shown, and when you are alone the area is empty.
- **Highlights of others' selections** — Tables, relationships, and notes that another person selected get an outline in that person's color, and tables get a name tag. **If they have several items selected, all of them are marked**, because before a bulk delete you need to see that someone else is working on those items right now (up to 50 per person are sent; if they select more, only the first 50 appear). Your own selection uses an inner blue border, so the two are distinguishable.
- **Notification toasts** — When the item you are viewing changes because of someone else's edit, **다른 사용자가 이 항목을 수정했습니다** ("Another user changed this item") appears. When it is deleted, **다른 사용자가 이 항목을 삭제했습니다** ("Another user deleted this item") appears. **If you have several items selected and only some of them are deleted, 다른 사용자가 선택 항목 중 일부를 삭제했습니다 ("Another user deleted some of the selected items") appears, and the rest of the selection is kept.** Only the deleted items leave the selection. The change notification also appears when **columns or indexes** of the table you are viewing change. There is at most one per change batch.

**Limits**

- When two people edit the same place at the same time, **the edit that arrives later wins.** Changes are not merged per character or field.
- If someone else's edit lands while yours is on its way to the server, the screen is resynced to the server's latest state as a whole. **The undo history is cleared at this point**, because what you would undo may already be gone. The group view you were viewing stays, and the selection stays only if its targets still exist.
- When the connection drops, it reconnects automatically at 1, 2, 4, and 8 second intervals. If it dropped because of a permission problem, it does not retry. If the server state cannot be loaded, **서버 상태를 불러오지 못했습니다. 새로고침해 주세요.** ("Could not load the server state. Please reload.") appears.
- Viewers receive the real-time screen and connected-user indicators normally. Only editing is blocked.

---

## 18. Access tokens

> **Not available in local mode.** There is no server to call (→ [local mode manual](./local-guide.md)).

**What** — A personal access token for the CLI. **CLI에서 쓰는 토큰입니다. 권한은 내 조직·프로젝트 역할을 그대로 따릅니다.** ("A token for the CLI. Its permissions follow your organization and project roles exactly.")

**Where** — The **액세스 토큰** (Access tokens) card on `/settings` (user menu → **설정**, Settings).

**How** — Enter a recognizable name in **토큰 이름** (Token name) (for example, 「노트북」, "laptop") and click **발급** (Issue). The token value appears in a yellow box, and **복사** (Copy) puts it on the clipboard. To revoke it, click **폐기** (Revoke) in the list, then click the red **정말 폐기** (Really revoke) once more.

**Limits** — **이 값은 지금만 보입니다 — 창을 닫으면 다시 볼 수 없습니다.** ("This value is shown only now. Once you close the window, you cannot see it again.") The list keeps only the name and last-used date, so if you lose a token, you reissue it rather than look it up. A token has the same permissions as your account's organization and project roles, so a token alone cannot get broader permissions. Conversely, **a token can do every write its issuer can do on the web.** An organization Owner/Admin's token can **create projects** from the CLI (`erdd init --create`) and **write directly to organization shared resources without approval** (`erdd dict push`), and a service admin's token writes **even to global shared resources**. So issue tokens for agents and CI from an editor account (→ [CLI manual 3.1](cli-guide.md#31-issue-a-personal-access-token)), issue tokens only where they are really needed, and revoke tokens you no longer use right away. With an empty name, **발급** is locked. With no tokens issued, **발급한 토큰이 없습니다.** ("You have not issued any tokens.") appears.

The **비밀번호 변경** (Change password) card at the top of the same screen changes your password. Enter **현재 비밀번호** (Current password), **새 비밀번호** (New password), and **새 비밀번호 확인** (Confirm new password), then click **변경 사항 저장** (Save changes). **변경하면 다른 기기의 로그인이 해제됩니다.** ("Changing it logs you out on other devices.")

**Using the CLI itself is outside the scope of this manual.** What you do once you hold a token (commands, file formats, how synchronization works) is in the [CLI manual](cli-guide.md).

---

## 19. Admin tasks

> **Not available in local mode.** There are no accounts, invites, or global shared resources (→ [local mode manual](./local-guide.md)).

**What** — The work done by people with the service role `admin`: inviting accounts and managing their status, issuing password reset links, and managing global shared resources. Organization-level work (organization invites, approving promotion requests, organization libraries) is done by Org Owners/Admins on the organization screens.

**Where** — `/admin` (user menu → **관리자**, Admin; title **계정 관리**, Account management). Organization work is on `/org/:orgId`.

### Invite accounts

Click **계정 초대** (Invite account), and the dialog says **계정을 만들지 않고 초대 링크만 만듭니다. 이름과 비밀번호는 본인이 정합니다.** ("This creates only an invite link, not an account. The person sets their own name and password."). Enter **이메일** (Email), choose **일반** (Regular) or **관리자** (Admin) under **역할** (Role), and click **초대 링크 만들기** (Create invite link). The link appears in a yellow box with **받는 사람** (Recipient) and the expiry. Copy it with **복사** (Copy), deliver it, and close with **닫기** (Close).

**Limits — this screen has no password field.** The admin creates only a link, not the account. The screen also states **초대 링크를 만들어 사람을 부르고, 만들어진 계정의 사용 상태를 관리합니다. 계정은 초대를 수락한 본인이 만들고 비밀번호도 본인만 정합니다.** ("Create invite links to bring people in, and manage the status of the resulting accounts. The person who accepts the invite creates the account, and only they set the password."). **이 링크는 지금만 볼 수 있습니다 — 창을 닫으면 다시 볼 수 없습니다. 잃으면 새로 발급하세요.** ("This link is shown only now. Once you close the window, you cannot see it again. If you lose it, issue a new one."). The plain-text link appears only in the issue response, so you cannot find it again in the list. You cannot create an invite for an email that already has an account.

### Account status and reset links

The account table shows email, name, role (**관리자** Admin / **일반** Regular), and status (**활성** Active / **비활성** Inactive).

- **Password reset link** — **비밀번호 재설정 링크** (Password reset link) on the row → **링크 만들기** (Create link). **링크를 만들어 사용자에게 전달합니다. 발급만으로는 비밀번호가 바뀌지 않고 로그인 세션도 유지됩니다.** ("Create a link and deliver it to the user. Issuing it alone does not change the password and keeps login sessions alive."). After issuing, the screen confirms again: **이 링크를 사용자에게 전달하세요. 사용자가 링크를 열어 새 비밀번호를 정해야 비밀번호가 바뀝니다.** ("Deliver this link to the user. The password changes only when the user opens the link and sets a new password."). It is valid for 24 hours, and there is no list screen, so the expiry shown in the box is the only place you can check it.
- **Active/inactive** — **비활성화** (Deactivate) / **활성화** (Activate) on the row changes whether the account can be used.

### Invite list and revocation

The **초대** (Invites) section at the bottom of `/admin` shows **only invites created by admins** (organization invites are separate, on the organization screens). The table shows email, role, status, expiry, and actions, and the status is **대기 중** (Pending), **사용됨** (Used), or **만료됨** (Expired). **Revoking** is **취소** (Cancel). Clicking it shows **초대를 취소했습니다** ("Invite cancelled"), and the link dies immediately. Rows shown as **만료됨** still have the cancel button, because expiry is judged by your browser's clock, and if the clock runs ahead, an invite that is still alive can look expired. Only invites that were already used have no button. With no invites sent, **보낸 초대가 없습니다.** ("No invites sent.") appears.

### Organization invites (Org Owner/Admin)

Issue them the same way in the **초대** (Invites) section of the organization details screen. Choose **초대할 이메일** (Email to invite) and a role (Member/Admin), then click **초대 링크 만들기** (Create invite link). When the person opens the link and creates an account, they join this organization with that role at the same time. The list, status, and cancellation are the same as on the admin screen, and cancelling also removes the link box shown on screen.

### Library management

**Global shared resources** are at the bottom of `/admin`, and **organization shared resources** are at the bottom of the organization details screen (managed only by Org Owners/Admins). Both work exactly the same way. Create one with **라이브러리 만들기** (Create library) → **이름** (Name), **설명 (선택)** (Description, optional) → **만들기** (Create). Each row in the list shows the description (or **설명 없음**, No description) and the item count, as in **〈설명〉 · 항목 16,565개** (〈description〉 · 16,565 items). Click a row to open the **라이브러리 조회 — 〈이름〉** (View library: 〈name〉) window. The tabs carry counts per kind, as in **단어 (3,280)** (Words), **용어 (13,159)** (Terms), **도메인 (126)** (Domains), and **커스텀 항목 (0)** (Custom fields), and the words tab opens first. Each tab has a search box (**논리명·물리명 검색**, Search logical name, physical name; words can also be found by abbreviation and English name, and domains and custom fields by name) and a table. With two or more pages, paging by 50 appears at the bottom. Changing the search term goes to page 1, and each tab keeps its search term and page when you switch away and come back. The table shows logical name, physical name, and English name for words; logical name, physical name, and domain for terms; name, category, and logical type for domains; and name, target, and type for custom fields, followed by the version (`v1`…). With no results, **검색 결과가 없습니다** ("No results") appears while searching, and **항목이 없습니다** ("No items") on an empty tab. With manage permission, each tab has **추가** (Add), and each row has a pencil (edit) and trash can (delete). Deleting goes through a confirmation: for a library, **"〈이름〉"을(를) 삭제하면 항목 N개도 함께 삭제됩니다. 계속할까요?** ("Deleting "〈name〉" also deletes its N items. Continue?"); for an item, **"〈이름〉"을(를) 삭제할까요? 이미 가져간 프로젝트의 사본은 그대로 남습니다.** ("Delete "〈name〉"? Copies already imported into projects remain.").

**Export** — The download icon on a library row (anyone who can read it, even without manage permission). Clicking it
downloads `〈이름〉.erdd-lib.yaml` (a shared library file) right away. If there were terms pointing to a deleted domain,
the notice **삭제된 도메인을 가리키던 용어 N건은 도메인 없이 내보냈습니다** ("N terms that pointed to a deleted domain
were exported without a domain") appears.

**Import** — The upload icon on a library row, only with manage permission. It opens the
**라이브러리 가져오기 — 〈이름〉** (Import library: 〈name〉) dialog.

**Create from file** — The button at the top of the list (manage permission only). It opens the **파일에서 만들기**
(Create from file) dialog, which also has **이름** (Name) and **설명 (선택)** (Description, optional) fields to fill
until you choose a file (choosing a file fills them with the file's library name and description; Excel does not fill
them).

**파일 선택** (Choose file) in both dialogs accepts shared library files (`.yaml`/`.yml`) and the Excel dictionary
template (`.xlsx`; the headers are the same as [Excel dictionary import in section 16](#excel-dictionary-import)). When
you choose a file, any format errors are listed line by line as they are (and that is the end, if there are any).
Otherwise the preview is computed and shown automatically, with the areas **추가** (Add), **갱신** (Update),
**그대로 N건** (N unchanged), **오래된 파일** (Stale file), and **파일에 없음** (Not in file), and the same warning appears
when you would delete a domain that remaining items point to. **오래된 파일** items are items where the server moved
ahead after the file's items were taken from this library (each item carries **서버 v〈현재〉, 파일 v〈파일값〉**,
"server v〈current〉, file v〈file value〉"). You must turn on the checkbox **오래된 파일 항목 N건 덮어쓰기** (Overwrite N
stale file items) to overwrite the server's new values with the file's old values. **파일에 없음** items are deleted only
when you turn on the checkbox **파일에 없는 항목 N건 삭제** (Delete N items not in the file) (a notice also says that
copies already imported into projects remain). If the file content is exactly the same as the library,
**파일 내용이 라이브러리와 같아 바뀐 항목이 없습니다** ("The file matches the library, so nothing changed") appears and
**가져오기 실행** (Run import) is disabled. If the library changed after you got the preview (for example, someone else
applied an import first), **미리보기 이후 라이브러리가 바뀌었습니다** ("The library changed after the preview") and a
**다시 미리보기** (Preview again) button appear. **가져오기 실행** is blocked until you preview again. Clicking
**가져오기 실행** shows the result in a toast: **추가 N · 갱신 N · 삭제 N** (N added · N updated · N deleted).

### Approve promotion requests

This happens in the **승격 요청** (Promotion requests) section of the organization details screen. The steps and limits are in [section 13](#13-shared-resources). The only way a request reaches the approver is the **승격 요청 N건** (N promotion requests) badge in the top bar. There are no email or push notifications, so check it periodically.

---

## 20. Selection and copy

**What** — Select tables and columns on the canvas to copy, cut, paste, and delete them. The clipboard holds JSON text in the system clipboard, so you can paste into other tabs and other projects.

**Where** — The canvas (table nodes) and the edit panel on the right. Shortcuts work anywhere in the document (outside input fields). See "Shortcuts" below for the exact conditions.

**How — select** — Click a table to select that one table (→ [section 4](#4-editor-basics)). Click a column row inside a table to select that column. The edit panel on the right immediately scrolls to that column row and highlights it with a blue border (if it is already visible, the panel does not move). `Cmd`/`Ctrl`+click adds the column to the selection or removes it (toggle), and `Shift`+click selects the range in order from the last selected column to the clicked column. Column selection works **only within one table**. Clicking a column selects only the table it belongs to (even if you had several tables selected, it narrows to one), and the column selection continues within it.

**How — select several tables** — There are two ways. `Cmd`/`Ctrl`+click a table to add it to the selection or remove it (toggle). Hold `Shift` and drag from an empty part of the canvas to draw a selection box, and **the tables** caught in the box are selected. In this case the selection is **replaced** by what the box catches; it is not added to. Color areas (groups) and notes are not included in this selection even if the box catches them, and neither are the outside tables (ghosts) shown dimmed in a group view because of relationships. A plain click without a modifier key leaves only that one table, and clicking empty space clears the selection.

When two or more tables are selected, the column selection is emptied, because column selection works only within one table. The edit panel then changes from the form to the **bulk action panel**. Under **N개 테이블 선택됨** (N tables selected) are the list of selected tables, the **선택 테이블의 그룹** (Group of selected tables) drop-down, and the **선택 테이블 삭제** (Delete selected tables) button. When you paste several tables at once (below), all the pasted tables are selected in this state right away.

**How — bulk action panel** — Choose a group in **선택 테이블의 그룹** to move all the selected tables into that group (the same as dragging and dropping → [section 4](#4-editor-basics)). **It is an alternative path for environments where dragging is hard**, so it also works from the keyboard. **선택 테이블 삭제** **asks for confirmation**: **선택한 테이블을 삭제할까요?** ("Delete the selected tables?") with **테이블 N개와 관계 M개가 삭제됩니다** ("N tables and M relationships will be deleted"), plus the number of columns and indexes that disappear with them and the list of targets. **삭제** on the bottom bar and the `Delete`/`Backspace` shortcut **also go through the same confirmation when two or more are selected** (with one, they delete it right away, as before). If more than 5,000 items are to be deleted, they are deleted in several batches, and a toast at the top of the screen shows progress, as in **적용 중… 1 / 2** (Applying… 1 / 2) (the confirmation closes as soon as you click). However many batches it takes, one undo reverts it.

**Where they move** — Changing the group also adjusts the canvas coordinates. The selected tables move to the right of the target group's area **while keeping their positions relative to each other**, and if other tables are already there, they are pushed down so they do not overlap. **When the target group is empty, or when you move to 미분류 (Ungrouped), the coordinates are not touched** (there is no area to use as a reference). The group move and the coordinate adjustment are **a single edit**, so one `Cmd`/`Ctrl`+`Z` reverts both.

**How — copy and paste**

- `Cmd`/`Ctrl`+`C` — If columns are selected, puts only those columns on the clipboard. Otherwise, puts all selected tables on the clipboard together with their columns and indexes.
- `Cmd`/`Ctrl`+`V` — If the clipboard holds columns, they are appended to the end (last in order) of the table **only when exactly one table is selected**. If the clipboard holds tables, they are pasted on the canvas. Each table is placed slightly down and to the right of its original position when copied, and all the pasted tables are selected right away.
- Pasting clipboard content that this app did not create (plain text copied from elsewhere and the like) is silently ignored.

**How — into another project** — You can paste into other tabs and other projects. A column's domain **is relinked if the target project has a domain with the same name**, and otherwise becomes **없음** (None). Even then, the type field's string itself stays exactly as copied. Custom field values likewise carry over **only to fields with the same name**, and are discarded if no field has the same name.

**Limits**

- **Name collisions are resolved automatically.** A duplicate logical name gets `_사본` (_copy), and if it still collides, `_사본2`, `_사본3`… in that order. Physical names get `_COPY`, `_COPY2`… in that order. Table physical names, column physical names, and index names all follow the same rule.
- **Group membership is not carried in a paste.** Pasted tables always go into Ungrouped.
- **Relationships are not copied.** A relationship needs the other table, so columns that were used as FKs become plain columns when pasted. If needed, draw the relationships again with the handles on the canvas after pasting (→ [section 6](#6-relationships)).
- **Pasting only columns does not carry over PK.** They come in with the `PK` check off, so that the target table's primary key does not change silently with one paste. When you paste whole tables, they are new tables, so the PK marks are kept.

**Shortcuts**

| Shortcut | Action |
|---|---|
| `Cmd`/`Ctrl` + `C` | Copy |
| `Cmd`/`Ctrl` + `X` | Cut (copy + delete) |
| `Cmd`/`Ctrl` + `V` | Paste |
| `Delete` / `Backspace` | Delete |

There are three conditions in which they do not work. When the cursor is in an **input field** (`input`, `textarea`, `select`, or a focused editable area), they all yield to the browser's default behavior. **When any dialog is open**, none of them work, to prevent accidentally deleting the canvas selection behind the dialog. With **read-only permission**, only `Cmd`/`Ctrl`+`C` works, and `X`, `V`, and `Delete`/`Backspace` are ignored.

**Cutting and deleting take one undo even when they remove many items at once.** All the selected tables and columns go out in a single edit, so one `Cmd`/`Ctrl`+`Z` (→ [section 4](#4-editor-basics)) brings back everything you removed. The **삭제** (Delete) button on the bottom bar is the same: all the selected tables are deleted in a single edit.

**Notes and relationship lines** — The same shortcuts also work on notes (→ [section 7](#7-indexes-and-notes)) and relationship lines (→ [section 6](#6-relationships)). Press `C`, `X`, or `Delete`/`Backspace` **after clicking a note or relationship line on the canvas to select it**.

| Selected item | `C` copy | `X` cut | `Delete`/`Backspace` delete |
|---|---|---|---|
| Note | O | O | O |
| Relationship line | — | — | O |

- **Paste (`V`) does not depend on what is selected**, which is why it is not in the table above. If the clipboard holds a note, a note is pasted, and if it holds tables, tables are pasted (whatever is selected). Only columns are an exception and require "exactly one table selected".
- **A pasted note** is placed slightly down and to the right of its original position when copied, and the pasted note is selected right away (the same rule as tables). You can paste into other tabs and other projects too.
- **You cannot paste a note in a group view** (it is silently ignored). A group view does not show notes at all, for the same reason that the **메모** (Note) button on the bottom bar is locked in a group view: to avoid a state where something was pasted but cannot be seen. Return to the full view and paste.
- **Relationship lines are not copied.** A relationship depends on the parent and child tables and their column pairs, so when pasting there is no way to decide which tables to attach it to. They can only be deleted.
- **Deleting a relationship line keeps the child table's FK columns.** Only the line disappears, and the columns remain as plain columns. To remove the columns too, delete them separately. This is exactly the same as the **관계 삭제** (Delete relationship) button in the right panel.
- Notes and relationship lines can be selected only one at a time, so **they do not go through the delete confirmation dialog** (that confirmation appears only when two or more tables are selected). If you deleted one by mistake, revert it with `Cmd`/`Ctrl`+`Z`.
- Pasting a note into another app (a notepad, an issue tracker, and so on) gives the JSON string this app uses, not human-readable text, because the format exists to duplicate notes within the app.

---

**Next** — To keep the schema as files in your repository and sync it from the command line, read the
[CLI manual](cli-guide.md). To use the same editor without a server, read the [local mode manual](local-guide.md).
