(function () {
  'use strict';

  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('primary-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  var path = window.location.pathname;
  document.querySelectorAll('.nav-link[href]').forEach(function (link) {
    var href = link.getAttribute('href');
    if (href && path === href) link.classList.add('active');
    if (link.getAttribute('data-nav') === 'integrations' && path.indexOf('/apps') === 0) {
      link.classList.add('active');
    }
    if (link.getAttribute('data-nav') === 'golive' && path === '/partners/review') {
      link.classList.add('active');
    }
    if (link.getAttribute('data-nav') === 'overview' && path === '/partners/dashboard') {
      link.classList.add('active');
    }
  });

  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      var message = form.getAttribute('data-confirm') || 'Are you sure?';
      if (!window.confirm(message)) {
        event.preventDefault();
      }
    });
  });

  document.querySelectorAll('form[data-progress]').forEach(function (form) {
    form.addEventListener('submit', function () {
      var button = form.querySelector('button[type="submit"]');
      if (button) {
        button.classList.add('is-busy');
        button.setAttribute('aria-busy', 'true');
        button.textContent = 'Working…';
      }
    });
  });

  document.querySelectorAll('[data-copy]').forEach(function (button) {
    button.addEventListener('click', function () {
      var target = document.querySelector(button.getAttribute('data-copy'));
      if (!target) return;
      var text = target.textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          button.textContent = 'Copied';
        }, function () {
          button.textContent = 'Select & copy';
        });
      } else {
        var range = document.createRange();
        range.selectNodeContents(target);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        button.textContent = 'Selected';
      }
    });
  });

  var restoreCopy = function (button, label) {
    var original = label || button.getAttribute('data-label') || button.textContent;
    button.textContent = 'Copied';
    button.classList.add('copied');
    window.setTimeout(function () {
      button.textContent = original;
      button.classList.remove('copied');
    }, 1600);
  };

  document.querySelectorAll('[data-subject]').forEach(function (button) {
    button.addEventListener('click', function () {
      var text = button.getAttribute('data-subject');
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          restoreCopy(button);
        });
      }
    });
  });

  // Admin decision dialogs — native <dialog>, confirm gated on ≥5-char reason.
  document.querySelectorAll('[data-decision-open]').forEach(function (button) {
    var dialog = document.getElementById('decision-' + button.getAttribute('data-decision-open'));
    if (!dialog || typeof dialog.showModal !== 'function') return;
    var textarea = dialog.querySelector('[data-charcount]');
    var counter = dialog.querySelector('[data-charcount-out]');
    var submit = dialog.querySelector('[data-decision-submit]');
    var update = function () {
      var len = textarea ? textarea.value.trim().length : 0;
      if (counter) counter.textContent = len + ' / 1000' + (len < 5 ? ' · min 5' : '');
      if (submit) submit.disabled = len < 5;
    };
    if (textarea) {
      textarea.addEventListener('input', update);
      update();
    }
    button.addEventListener('click', function () { dialog.showModal(); });
    dialog.querySelectorAll('[data-decision-close]').forEach(function (close) {
      close.addEventListener('click', function () { dialog.close(); });
    });
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) dialog.close(); // backdrop click
    });
  });

  // "I've stored it" checkbox gates continuing past a one-time secret page.
  var stored = document.querySelector('[data-secret-confirm]');
  if (stored) {
    var continueEl = document.querySelector('[data-secret-continue]');
    var syncGate = function () {
      if (continueEl) {
        if (stored.checked) {
          continueEl.classList.remove('btn-disabled');
          continueEl.removeAttribute('aria-disabled');
        } else {
          continueEl.classList.add('btn-disabled');
          continueEl.setAttribute('aria-disabled', 'true');
        }
      }
    };
    stored.addEventListener('change', syncGate);
    syncGate();
  }

  // Sync Space pairing QR scanner — BarcodeDetector where the browser offers
  // it; the paste textarea stays as the always-available fallback.
  var scanRoot = document.getElementById('qr-scan-root');
  if (scanRoot && 'BarcodeDetector' in window && navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function') {
    var startButton = scanRoot.querySelector('[data-qr-start]');
    var cameraBox = scanRoot.querySelector('[data-qr-camera]');
    var video = scanRoot.querySelector('[data-qr-video]');
    var statusText = scanRoot.querySelector('[data-qr-status]');
    var input = scanRoot.querySelector('[data-qr-input]');
    var scanForm = scanRoot.querySelector('form');
    var stream = null;
    var rafId = null;
    var detector = null;

    var stopCamera = function () {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (stream) {
        stream.getTracks().forEach(function (track) { track.stop(); });
        stream = null;
      }
      if (video) video.srcObject = null;
      if (cameraBox) cameraBox.hidden = true;
    };

    try {
      detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch (e) {
      detector = null;
    }

    if (detector && startButton) {
      startButton.hidden = false;
      startButton.addEventListener('click', function () {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
          .then(function (media) {
            stream = media;
            video.srcObject = media;
            cameraBox.hidden = false;
            statusText.textContent = 'Point the camera at the customer\u2019s QR\u2026';
            return video.play();
          })
          .then(function () {
            var tick = function () {
              if (!stream) return;
              detector.detect(video).then(function (codes) {
                if (codes && codes.length && codes[0].rawValue) {
                  var value = String(codes[0].rawValue);
                  if (value.indexOf('syncspace:pair:') === 0) {
                    input.value = value;
                    stopCamera();
                    if (scanForm && typeof scanForm.requestSubmit === 'function') {
                      scanForm.requestSubmit();
                    } else if (scanForm) {
                      scanForm.submit();
                    }
                    return;
                  }
                  statusText.textContent = 'That QR is not a Sync Space code.';
                }
                rafId = requestAnimationFrame(tick);
              }).catch(function () {
                rafId = requestAnimationFrame(tick);
              });
            };
            rafId = requestAnimationFrame(tick);
          })
          .catch(function () {
            statusText.textContent = 'Camera unavailable — paste the QR payload below.';
            stopCamera();
          });
      });

      if (scanForm) {
        scanForm.addEventListener('submit', function () { stopCamera(); });
      }
      window.addEventListener('pagehide', stopCamera);
      window.addEventListener('beforeunload', stopCamera);
    }
  }
})();
