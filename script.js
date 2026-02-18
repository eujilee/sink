// =========================
// 0) 라벨(표시용)
// =========================
const WORK_LABEL = { sink: "씽크대", built_in: "붙박이장", shoe: "신발장", drawer: "홈바", etc: "기타" };

// =========================
// 1) Sanity 설정
// =========================
const SANITY_PROJECT_ID = "pz8v29ws";
const SANITY_DATASET = "production";
const SANITY_API_VERSION = "2025-01-01";

// =========================
// 2) Sanity 쿼리 유틸
// =========================
async function sanityQuery(groq) {
  const url =
    `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/data/query/${SANITY_DATASET}?query=` +
    encodeURIComponent(groq);

  const res = await fetch(url);
  if (!res.ok) throw new Error("Sanity fetch failed: " + res.status);
  const json = await res.json();
  return json.result;
}

function toProject(p) {
  return {
    id: p._id,
    slug: p.slug,
    title: p.title,
    date: p.date,
    region: p.region,
    work: p.works || [],
    meta: p.summary || "",
    image: p.coverUrl || "",
    content: p.content || [], // ✅ 글/사진 순서 블록
  };
}

async function fetchProjects({ work = "", q = "", limit = null } = {}) {

  const where = [`_type == "project"`];
  if (work) where.push(`"${work}" in works`);
  if (q) where.push(`(title match "*${q}*" || summary match "*${q}*")`);

  // 목록은 썸네일/요약만 필요
const range = (typeof limit === "number") ? `[0...${limit}]` : "";

const groq = `*[
  ${where.join(" && ")}
] | order(date desc)${range}{
   
    _id,
    "slug": slug.current,
    title, date, region, works, summary,
    "coverUrl": coverImage.asset->url
  }`;

  const result = await sanityQuery(groq);
  return result.map(toProject);
}

async function fetchProjectBySlug(slug) {
  // ✅ 상세는 content(글/사진 순서)까지 가져오기
  const groq = `*[_type=="project" && slug.current=="${slug}"][0]{
    _id,
    "slug": slug.current,
    title, date, region, works, summary,
    "coverUrl": coverImage.asset->url,

    content[]{
      ...,
      _type == "image" => {
        "url": asset->url,
        "alt": coalesce(alt, "")
      }
    }
  }`;

  const p = await sanityQuery(groq);
  return p ? toProject(p) : null;
}

function getQueryParam(key) {
  const url = new URL(window.location.href);
  return url.searchParams.get(key);
}

// =========================
// 3) 상세 본문(글/사진) 렌더 유틸
// =========================
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderContentBlocks(blocks) {
  if (!Array.isArray(blocks)) return "";

  return blocks
    .map((b) => {
      if (b?._type === "block") {
        const text = (b.children || []).map((c) => escapeHtml(c.text || "")).join("");
        if (!text.trim()) return "";
        return `<p class="detail__p">${text}</p>`;
      }

      if (b?._type === "image") {
        const url = b.url;
        if (!url) return "";
        const alt = escapeHtml(b.alt || "");
        return `
          <div class="detail__media">
            <img src="${url}" alt="${alt}" loading="lazy" />
          </div>
        `;
      }

      return "";
    })
    .join("");
}

// =========================
// 4) index.html(목록) 렌더
// =========================
const els = {
  grid: document.getElementById("projectGrid"),
  region: document.getElementById("filterRegion"),
  work: document.getElementById("filterWork"),
  q: document.getElementById("filterQ"),
};

async function renderList() {
  if (!els.grid) return;

  const work = els.work?.value || "";
  const q = (els.q?.value || "").trim();

  els.grid.innerHTML = `<div class="card" style="grid-column:1/-1">불러오는 중...</div>`;

  let items = [];
  try {
const isHome = window.location.pathname.endsWith("/") || window.location.pathname.endsWith("index.html");

items = await fetchProjects({
  work,
  q,
  limit: isHome ? 6 : null
});

  } catch (e) {
    console.error(e);
    els.grid.innerHTML = `<div class="card" style="grid-column:1/-1">데이터를 불러오지 못했어요. (CORS/Project ID 확인)</div>`;
    return;
  }

  els.grid.innerHTML = items
    .map((p) => {
      const regionLabel = REGION_LABEL[p.region] || p.region;
      const tags = p.work.map((w) => WORK_LABEL[w] || w).join(", ");

      return `
        <a class="project" href="./project.html?slug=${encodeURIComponent(p.slug)}" title="상세 보기">
          <div class="project__thumb">
            <img src="${p.image}" alt="${p.title}" loading="lazy" />
          </div>
          <div class="project__body">
            <div class="project__meta">${regionLabel}${p.date ? " · " + p.date : ""}</div>
            <div class="project__title">${p.title}</div>
            <div class="project__tags">${tags}${p.meta ? " · " + p.meta : ""}</div>
          </div>
        </a>
      `;
    })
    .join("");

  if (items.length === 0) {
    els.grid.innerHTML = `
      <div class="card" style="grid-column:1/-1">
        조건에 맞는 시공사례가 없어요. 필터를 바꿔보세요.
      </div>
    `;
  }
}

// =========================
// 5) project.html(상세) 렌더
// =========================
async function renderDetail() {
  const detailEl = document.getElementById("detail");
  if (!detailEl) return;

  const slug = getQueryParam("slug");
  if (!slug) {
    detailEl.innerHTML = `
      <div class="card">
        <div class="card__title">잘못된 접근이에요.</div>
        <p class="card__desc">목록에서 시공사례를 선택해 주세요.</p>
      </div>
    `;
    return;
  }

  detailEl.innerHTML = `<div class="card">불러오는 중...</div>`;

  let p = null;
  try {
    p = await fetchProjectBySlug(slug);
  } catch (e) {
    console.error(e);
    detailEl.innerHTML = `<div class="card">상세 데이터를 불러오지 못했어요. (CORS/Project ID 확인)</div>`;
    return;
  }

  if (!p) {
    detailEl.innerHTML = `
      <div class="card">
        <div class="card__title">시공사례를 찾을 수 없어요.</div>
        <p class="card__desc">목록에서 다시 선택해 주세요.</p>
      </div>
    `;
    return;
  }

  const regionLabel = REGION_LABEL[p.region] || p.region;
  const tags = p.work.map((w) => WORK_LABEL[w] || w).join(", ");
  const bodyHtml = renderContentBlocks(p.content);

  detailEl.innerHTML = `
    <div class="detail">
      <div class="detail__meta">${regionLabel}${p.date ? " · " + p.date : ""} · ${tags}</div>
      <h1 class="detail__title">${p.title}</h1>
      ${p.meta ? `<p class="detail__desc">${p.meta}</p>` : ""}

      <div class="detail__hero">
        <img src="${p.image}" alt="${p.title}" />
      </div>

      <div class="detail__body">
        ${bodyHtml}
      </div>

      <div class="detail__cta card" style="margin-top:16px">
        <div class="card__title">이 시공과 비슷하게 원하시나요?</div>
        <p class="card__desc">작업 종류/사이즈/지역을 알려주시면 빠르게 안내드릴게요.</p>
        <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
          <a class="btn btn--primary" href="./index.html#contact">문의하기</a>
          <a class="btn" href="tel:010-9181-5373">전화하기</a>
        </div>
      </div>
    </div>
  `;
}

// =========================
// 6) 이벤트 바인딩 & 실행
// =========================
if (els.region) els.region.addEventListener("change", renderList);
if (els.work) els.work.addEventListener("change", renderList);
if (els.q) els.q.addEventListener("input", renderList);

renderList();
renderDetail();
function initSlider() {
  const slider = document.querySelector(".slider");
  if (!slider) return;

  const track = slider.querySelector(".slider__track");
  const slides = track.querySelectorAll("img");
  const prevBtn = slider.querySelector(".slider__prev");
  const nextBtn = slider.querySelector(".slider__next");

  let index = 0;
  const total = slides.length;

  function updateSlide() {
    track.style.transform = `translateX(-${index * 100}%)`;
  }

  function nextSlide() {
    index = (index + 1) % total;
    updateSlide();
  }

  function prevSlide() {
    index = (index - 1 + total) % total;
    updateSlide();
  }

  nextBtn.addEventListener("click", nextSlide);
  prevBtn.addEventListener("click", prevSlide);

  // 자동 슬라이드 (3초)
  setInterval(nextSlide, 3000);
}

document.addEventListener("DOMContentLoaded", initSlider);
