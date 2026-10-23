// ============================================================
// Elden Earth — Community hub
// Posts / comments / likes. ALL writes go through server callables
// (profanity-filtered, rate-limited, moderated) so UGC stays
// AdSense-safe. Reads are public.
// ============================================================
(function () {
  "use strict";

  var db, fns;
  var me = null;
  var unsub = null;
  var openComments = {};

  function esc(s) { return window.Portal ? Portal.esc(s) : String(s || ""); }
  function timeAgo(ts) { return window.Portal ? Portal.timeAgo(ts) : ""; }

  function avatarHTML(author) {
    var av = author && author.authorAvatar;
    if (av && String(av).indexOf("img:") === 0) {
      return "<img src=\"" + esc(String(av).slice(4)) + "\" alt=\"\">";
    }
    return "<div class=\"avatar-fallback\">" + esc(av || "🙂") + "</div>";
  }

  function signInWall() {
    return (
      "<div class=\"signin-wall\"><h3>Join the conversation</h3>" +
      "<p>Sign in with Google to post, comment and cheer on your fellow travelers.</p>" +
      "<button class=\"btn btn-primary\" id=\"community-signin\">Sign in with Google</button></div>"
    );
  }

  function composerHTML() {
    return (
      "<div class=\"composer\" id=\"post-composer\">" +
      "<div style=\"display:flex;gap:12px;margin-bottom:12px;align-items:center\">" +
      "<strong>Share with the Realm</strong>" +
      "<select id=\"post-tag\" style=\"margin-left:auto;background:rgba(0,0,0,.28);color:#e9edf5;border:1px solid #263349;border-radius:10px;padding:9px 12px\">" +
      "<option value=\"general\">General</option><option value=\"guides\">Guide / Tips</option>" +
      "<option value=\"trading\">Trading</option><option value=\"screenshots\">Screenshot</option>" +
      "<option value=\"feedback\">Feedback</option><option value=\"clans\">Recruitment</option>" +
      "</select></div>" +
      "<input id=\"post-title\" maxlength=\"80\" placeholder=\"Title — what's happening in your realm?\">" +
      "<textarea id=\"post-body\" rows=\"4\" maxlength=\"2000\" placeholder=\"Share a strategy, a screenshot story, a trade tip, or say hi...\"></textarea>" +
      "<div style=\"display:flex;align-items:center;gap:12px;margin-top:12px\">" +
      "<span class=\"footer-note\" id=\"post-count\">0 / 2000</span>" +
      "<button class=\"btn btn-primary btn-sm\" id=\"post-submit\" style=\"margin-left:auto\">Publish post</button>" +
      "</div></div>"
    );
  }

  function postHTML(p) {
    var liked = p.__liked;
    return (
      "<article class=\"post\" data-post=\"" + esc(p.id) + "\">" +
      "<div class=\"post-head\">" + avatarHTML(p) +
      "<div><div class=\"who\">" + esc(p.authorName || "Traveler") + "</div>" +
      "<div class=\"when\">" + timeAgo(p.createdAt) + (p.tag ? " · " + esc(p.tag) : "") + "</div></div>" +
      (p.authorId === (me && me.uid) ? "<button class=\"chip-btn\" data-delete=\"" + esc(p.id) + "\" style=\"margin-left:auto\">Delete</button>" : "") +
      "</div>" +
      "<h3>" + esc(p.title) + "</h3>" +
      "<div class=\"body\">" + esc(p.body) + "</div>" +
      "<div class=\"post-actions\">" +
      "<button class=\"chip-btn" + (liked ? " liked" : "") + " data-like=\"" + esc(p.id) + "\">★ " + (Number(p.likes) || 0) + " cheers</button>" +
      "<button class=\"chip-btn\" data-comments=\"" + esc(p.id) + "\">💬 " + (Number(p.commentCount) || 0) + " comments</button>" +
      "</div>" +
      "<div class=\"comments\" id=\"comments-" + esc(p.id) + "\"></div>" +
      "</article>"
    );
  }

  function commentHTML(c) {
    return (
      "<div class=\"comment\">" + avatarHTML(c) +
      "<div><div class=\"who\">" + esc(c.authorName || "Traveler") + " <span class=\"when\">" + timeAgo(c.createdAt) + "</span></div>" +
      "<div class=\"body\">" + esc(c.body) + "</div></div></div>"
    );
  }

  function renderFeed(docs) {
    var feed = document.getElementById("community-feed");
    if (!feed) return;
    if (!docs.length) {
      feed.innerHTML = "<div class=\"card\"><h3>The realm is quiet… for now</h3><p>Be the first to post something — a tip, a screenshot story, or a hello.</p></div>";
      return;
    }
    feed.innerHTML = docs.map(postHTML).join("");
  }

  function loadComments(postId) {
    var box = document.getElementById("comments-" + postId);
    if (!box) return;
    box.innerHTML = "<div class=\"footer-note\" style=\"padding:10px 0\">Loading comments…</div>";
    db.collection("site_posts").doc(postId).collection("comments")
      .orderBy("createdAt", "asc").limit(60).get()
      .then(function (snap) {
        var html = snap.docs.map(function (d) {
          var c = d.data() || {};
          c.id = d.id;
          return commentHTML(c);
        }).join("");
        html += me
          ? "<div class=\"comment\"><div><input class=\"c-input\" data-new-comment=\"" + postId + "\" placeholder=\"Write a comment…\" maxlength=\"500\" style=\"width:100%;background:rgba(0,0,0,.28);color:#e9edf5;border:1px solid #263349;border-radius:10px;padding:10px 13px\"></div></div>"
          : "<div class=\"footer-note\" style=\"padding:10px 0\">Sign in to comment.</div>";
        box.innerHTML = html;
      })
      .catch(function (e) {
        box.innerHTML = "<div class=\"footer-note\" style=\"padding:10px 0\">Comments unavailable.</div>";
        console.warn("[Community] comments:", e && e.message);
      });
  }

  function refresh() {
    if (unsub) unsub();
    unsub = db.collection("site_posts")
      .orderBy("createdAt", "desc").limit(40)
      .onSnapshot(function (snap) {
        var docs = snap.docs.map(function (d) {
          var p = d.data() || {};
          p.id = d.id;
          return p;
        }).filter(function (p) { return p.hidden !== true; });
        renderFeed(docs);
      }, function (e) {
        console.warn("[Community] feed:", e && e.message);
        var feed = document.getElementById("community-feed");
        if (feed) feed.innerHTML = "<div class=\"card\"><p>Community feed is loading… refresh in a moment.</p></div>";
      });
  }

  async function submitPost() {
    var title = (document.getElementById("post-title").value || "").trim();
    var body = (document.getElementById("post-body").value || "").trim();
    var tag = document.getElementById("post-tag").value;
    if (title.length < 3) { alert("Give your post a title (3+ characters)."); return; }
    if (body.length < 3) { alert("Write a little something in the body."); return; }
    var btn = document.getElementById("post-submit");
    btn.disabled = true;
    try {
      var res = await fns("createSitePost")({ title: title, body: body, tag: tag });
      var data = res && res.data ? res.data : res;
      if (!data || !data.ok) {
        alert(data && data.reason === "profanity"
          ? "Please keep posts clean — this one was flagged by the filter."
          : data && data.reason === "rate_limited"
            ? "You're posting quickly — wait a moment and try again."
            : "Could not publish the post. Please try again.");
        return;
      }
      document.getElementById("post-title").value = "";
      document.getElementById("post-body").value = "";
      document.getElementById("post-count").textContent = "0 / 2000";
    } catch (e) {
      alert("Could not publish the post. Please try again.");
    } finally {
      btn.disabled = false;
    }
  }

  function fns(name) {
    return firebase.functions().httpsCallable(name);
  }

  function wire() {
    document.addEventListener("click", async function (e) {
      var t = e.target.closest("button, [data-like], [data-comments], [data-delete]");
      if (!t) return;

      if (t.id === "community-signin") {
        var b = document.getElementById("site-signin");
        if (b) b.click();
        return;
      }
      if (t.id === "post-submit") { submitPost(); return; }

      if (t.dataset.like) {
        if (!me) { alert("Sign in with Google to cheer a post."); return; }
        t.disabled = true;
        try { await fns("toggleSiteLike")({ postId: t.dataset.like }); } catch (err) {}
        t.disabled = false;
        return;
      }
      if (t.dataset.comments) {
        var pid = t.dataset.comments;
        if (openComments[pid]) {
          var box = document.getElementById("comments-" + pid);
          if (box) box.innerHTML = "";
          delete openComments[pid];
        } else {
          openComments[pid] = true;
          loadComments(pid);
        }
        return;
      }
      if (t.dataset.delete) {
        if (!confirm("Delete this post?")) return;
        try {
          await fns("deleteSitePost")({ postId: t.dataset.delete });
        } catch (err) { alert("Could not delete the post."); }
        return;
      }
    });

    document.addEventListener("keydown", async function (e) {
      if (e.key !== "Enter" || !e.target.dataset || !e.target.dataset.newComment) return;
      var pid = e.target.dataset.newComment;
      var body = (e.target.value || "").trim();
      if (!body) return;
      e.target.disabled = true;
      try {
        var res = await fns("createSiteComment")({ postId: pid, body: body });
        var data = res && res.data ? res.data : res;
        if (data && data.ok) loadComments(pid);
        else alert("Could not post the comment.");
      } catch (err) {
        alert("Could not post the comment.");
      }
    });

    document.addEventListener("input", function (e) {
      if (e.target.id === "post-body") {
        var c = document.getElementById("post-count");
        if (c) c.textContent = (e.target.value || "").length + " / 2000";
      }
    });
  }

  function boot() {
    if (typeof firebase === "undefined") return;
    db = firebase.firestore();
    wire();
    Portal.whenAuthReady(function (user) {
      me = user;
      var mount = document.getElementById("community-mount");
      if (!mount) return;
      mount.innerHTML = me ? composerHTML() : signInWall();
      refresh();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
