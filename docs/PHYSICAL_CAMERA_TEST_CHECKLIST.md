# Physical camera test checklist

Record browser/version, OS, camera make, facility lighting, network, UTC time, and tester. Use authorized test plates/images and delete them afterward.

- [ ] Chrome, Edge, Firefox, and Safari where APIs are supported.
- [ ] Built-in and connected USB camera.
- [ ] Permission allow, deny, revoke, and re-allow.
- [ ] No microphone prompt or active audio track.
- [ ] Labels appear only after permission.
- [ ] Camera selection changes the real source.
- [ ] Disconnect/reconnect produces a visible state and no silent arming.
- [ ] 1920×1080 preferred; 720p/lower fallback still captures.
- [ ] Manual capture produces 3–5 distinct JPEG frames ~200–300 ms apart.
- [ ] Motion enters region, stabilizes, triggers once, and respects cooldown.
- [ ] Motion outside region does not trigger.
- [ ] Screen Wake Lock after user arms; reacquired after visibility.
- [ ] Heartbeat healthy, then stale when browser/network stops.
- [ ] Offline/online retry while page remains open.
- [ ] Navigation warns with pending frames; discard releases them.
- [ ] Browser storage inspection contains no images/base64/object URLs.
- [ ] Canvas is cleared and no service worker/background sync exists.
- [ ] Direct upload uses private S3; no public image URL.
- [ ] Cold worker does not delay browser capture/upload.
- [ ] Recognized, review, no-plate, multiple-plate, and failure UI states.
- [ ] Low-confidence/review/no-plate never creates unregistered alert.
- [ ] Registered entry no alert; high-confidence unregistered/blocked entry alerts.
- [ ] Entry/exit opens/closes visit; orphan/repeated entry anomalies.
- [ ] Facility-local display and UTC audit timestamps are plausible.
- [ ] Screen reader labels, keyboard order, focus, contrast, narrow viewport.
- [ ] Physical entrance notice/signage is visible and approved.

Attach only non-sensitive result IDs and measured timing to the test report.
