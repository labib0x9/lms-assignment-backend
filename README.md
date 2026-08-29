# 🎓 LMS Backend (Strapi v5 + PostgreSQL)

---

## 🚀 How to Run Locally

### 1. Prerequisites
- **Node.js**: `v20+` or `v22+` (or `v25`)
- **PostgreSQL**: `v14+` running locally or via Docker
- **npm** or **yarn**

---

### 2. Setup PostgreSQL Database
Ensure PostgreSQL is running and create the `lms` database:
```sql
CREATE DATABASE lms;
CREATE USER lms WITH ENCRYPTED PASSWORD 'p@ssw0rd';
GRANT ALL PRIVILEGES ON DATABASE lms TO lms;
```

---

### 3. Environment Configuration
Copy the `.env.example` file to `.env`:
```bash
cp .env.example .env
```
Verify your `.env` contains your PostgreSQL credentials:
```env
HOST=0.0.0.0
PORT=1337

# Database Configuration
DATABASE_CLIENT=postgres
DATABASE_HOST=127.0.0.1
DATABASE_PORT=5432
DATABASE_NAME=lms
DATABASE_USERNAME=lms
DATABASE_PASSWORD=p@ssw0rd
DATABASE_SSL=false
```

---

### 4. Install Dependencies & Start Server
```bash
# Install dependencies
npm install

# Start Strapi development server with auto-reload
npm run dev
```

The Strapi server will boot up and be accessible at:
- **API Server**: `http://localhost:1337`
- **Admin Panel**: `http://localhost:1337/admin`

---

## 📋 Feature Completion Status

**Core features (all 4 required): ✅ Complete**
Authentication + RBAC, Course/Lesson Management, Enrollment, and Lesson Viewing are fully implemented and working end-to-end.

**Differentiator features: 2 of 4 implemented (1 partially)**
Given the project timeline, I prioritized Progress Tracking and Quiz Auto-Grading — Admin Panel and Blog were scoped out to ensure the core and these two differentiators were built solidly rather than spreading effort across all four.

| Feature | Status |
|---|---|
| Authentication + Role-Based Access | ✅ Complete |
| Course & Lesson Management | ✅ Complete |
| Course Enrollment | ✅ Complete |
| Progress Tracking | ⚠️ Partially complete — see note below |
| Quiz & Auto-Grading | ✅ Complete |
| Admin Panel | ❌ Not implemented |
| Blog (Writing & Control) | ❌ Not implemented |

> **Progress Tracking gap:** a student marking lessons complete and viewing their own progress works fully. Per the permission matrix, "View student progress" should also be available to Admin (all courses), Content Manager (all courses), and Instructor (their own courses) — that cross-role viewing endpoint is not yet implemented. Currently only a student can view their own progress.

---

## ✅ Completed Features

### 1. 🔐 Authentication & Role-Based Access Control (RBAC)
- **4 Custom Roles**: `student`, `instructor`, `admin`, `content_manager`.
- Role verification using strict `role.type` matching across all controllers and policies.
- Clean JWT authentication attaching user session context.

### 2. 📚 Course & Curriculum Management
- **Course Authoring**: Instructors, Admins, and Content Managers can create and publish courses.
- **Instructors Relation**: Automatically links created courses to the authenticated instructor.
- **Ownership Policies**: [`is-course-owner.js`](src/policies/is-course-owner.js) and [`is-lesson-owner.js`](src/policies/is-lesson-owner.js) prevent instructors from editing other instructors' courses.

### 3. 📝 Lesson Management & Content Delivery
- **Ordered Lessons**: Lessons are structured with sequential ordering (`order: asc`) and full Markdown content support.
- **Gated Viewing Policy**: [`can-view-lesson.js`](src/policies/can-view-lesson.js) ensures only enrolled students (or instructors/admins) can view lesson details.

### 4. 🎓 Course Enrollment System
- **Self-Enrollment**: Students can browse courses and enroll (`POST /api/enrolls`).
- **Duplicate Prevention**: Prevents double-enrollment in the same course.
- **Scoped Views**: Students only see their enrolled courses under "My Courses"; instructors see enrollments in their own courses.
- **Unenrollment**: Students can unenroll (`DELETE /api/enrolls/:id`), which automatically cleans up completed progress records.

### 5. 📊 Progress Tracking — ⚠️ Partially Complete
- **Lesson Toggle**: `POST /api/progresses/lesson/toggle` to mark lessons complete or incomplete.
- **Enrollment-Driven Progress**: `GET /api/progresses` queries active enrollments first so newly enrolled courses appear immediately on the dashboard with `0%` progress.
- **Course Summary**: Calculates total lessons, completed count, completion percentage, and full completion badge.
- **Not implemented**: viewing a course's student progress as Admin, Content Manager, or Instructor. Only a student's view of their own progress is currently supported — the cross-role progress view from the permission matrix is missing.

### 6. 🧠 Quiz & Auto-Grading System
- **Quiz Authoring**: Instructors can create quizzes (`POST /api/quizzes`) and attach multiple-choice questions with points (`POST /api/questions`).
- **Anti-Cheat Protection**: The `correct_answer` column is hidden from students during quiz queries and only evaluated on the server.
- **Server-Side Auto-Grading**: `POST /api/quizzes/:id/submit` compares submitted answer indices against master answers, calculates the percentage score, and stores a question-by-question breakdown (`answers` JSON).
- **Submission History**: `GET /api/quizzes/:id/my-submission` enables students to review their latest score and breakdown.

---

## 🚧 Not Implemented (Out of Scope)

### Admin Panel
Not built for this submission. Given the timeline, effort went into making the core features and the two implemented differentiators robust rather than adding a dedicated admin dashboard on top.

### Blog (Writing & Control)
Not built for this submission, for the same reason — deprioritized in favor of solidifying Progress Tracking and Quiz Auto-Grading.

---

## 📡 API Endpoints Overview

| Method | Endpoint | Description | Role / Access |
|---|---|---|---|
| `POST` | `/api/auth/local` | User Login (returns JWT & role) | Public |
| `POST` | `/api/auth/local/register` | Student Registration | Public |
| `GET` | `/api/courses` | List all published courses | Public / Authenticated |
| `GET` | `/api/courses/:id` | Get course details & curriculum | Public / Authenticated |
| `POST` | `/api/courses` | Create a new course | Instructor, Content-Manager, Admin |
| `GET` | `/api/lessons/:id` | View lesson markdown content | Enrolled Student, Instructor, Content Manager, Admin |
| `POST` | `/api/enrolls` | Enroll in a course | Authenticated Student |
| `GET` | `/api/enrolls` | Get user's active enrollments | Authenticated Student |
| `POST` | `/api/progresses/lesson/toggle` | Toggle lesson completed/uncompleted | Enrolled Student |
| `GET` | `/api/progresses` | Get student progress across enrolled courses | Authenticated Student |
| `GET` | `/api/quizzes/course/:courseId` | List quizzes for an enrolled course | Enrolled Student, Admin, Content Manager, Instructor |
| `POST` | `/api/quizzes/:id/submit` | Submit answers & auto-grade quiz | Enrolled Student |
| `GET` | `/api/quizzes/:id/my-submission` | Fetch latest quiz attempt result | Enrolled Student |