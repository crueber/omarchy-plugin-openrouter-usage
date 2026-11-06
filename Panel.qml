import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Model.js" as Model

// OpenRouter key usage in the bar: the key's own spend against its limit, or
// just the spend when the key has no limit. The previous completed cycle is
// kept locally so the bar can turn yellow when the current cycle runs above
// it. The API key is read by scripts/fetch.js from the existing OpenCode
// credential store (or OPENROUTER_API_KEY) and is never put in the cache.
Panel {
  id: root
  moduleName: "crueber.openrouter-usage"
  ipcTarget: "openrouter-usage"
  manageIpc: false

  // ------------------------------------------------------------------ theme

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property color track: Style.selectedFillFor(foreground, Color.accent)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property bool vertical: bar ? bar.vertical : false

  // --------------------------------------------------------------- settings

  readonly property int refreshIntervalSec: Model.clampInt(setting("refreshIntervalSec", 300), 60, 3600, 300)
  readonly property string nodeCommand: String(setting("nodeCommand", ""))
  readonly property string authFile: String(setting("authFile", ""))
  readonly property bool showCredits: setting("showCredits", true) !== false
  readonly property string compareColor: String(setting("compareColor", "#d9b45b"))
  readonly property string warningColor: String(setting("warningColor", "#f67400"))
  readonly property string criticalColor: String(setting("criticalColor", ""))
  readonly property string rightClickCommand: String(setting("onRightClick", ""))

  readonly property string executable: nodeCommand !== "" ? nodeCommand : "node"
  readonly property string helperPath: {
    var value = String(Qt.resolvedUrl("scripts/fetch.js"))
    if (value.indexOf("file://") === 0) value = value.slice(7)
    try { value = decodeURIComponent(value) } catch (e) {}
    return value
  }

  // ------------------------------------------------------------------- data

  property var report: null
  property var history: Model.emptyHistory()
  property string errorText: ""
  property string lastErrorMessage: ""
  property string stderrText: ""
  property bool gotOutput: false
  property double lastFetchMs: 0
  property double lastAttemptMs: 0
  property int fetchFailures: 0
  property double nowMs: Date.now()

  property bool cacheLoadAttempted: false
  property bool settingsReady: false
  property bool startupDone: false
  property bool pollLeader: false
  property int consumedSeq: 0

  readonly property string cacheHome: {
    var xdg = Quickshell.env("XDG_CACHE_HOME")
    if (xdg) return xdg
    var home = Quickshell.env("HOME")
    return home ? home + "/.cache" : "/tmp"
  }
  readonly property string cacheDir: root.cacheHome + "/openrouter-usage"
  readonly property string cachePath: root.cacheDir + "/usage.json"

  readonly property var state: Model.comparison(report, history)
  readonly property bool busy: fetchProc.running
  readonly property bool showBarUsage: report !== null && report.spend > 0
  readonly property string barText: Model.barText(report, state)
  readonly property string heroDetail: Model.heroDetail(report, state)
  readonly property string refreshNote: report !== null && lastErrorMessage !== "" ? "read failed" : ""
  readonly property string tooltipText: Model.tooltip(report, state, history, nowMs)
  readonly property string footerText: {
    var parts = []
    var updated = Model.updatedText(root.lastFetchMs, root.nowMs)
    if (updated !== "") parts.push(updated)
    if (root.refreshNote !== "") parts.push(root.refreshNote)
    parts.push("via OpenRouter key")
    return parts.join(" · ")
  }
  readonly property string heroMeta: {
    if (!report) return errorText !== "" ? "No key data" : "Reading key"
    var parts = []
    if (report.label !== "") parts.push(report.label)
    parts.push(Model.intervalName(report.resetInterval))
    return parts.join(" · ")
  }

  function stateColor(name) {
    if (name === "critical") return criticalColor !== "" ? criticalColor : urgent
    if (name === "orange") return warningColor
    if (name === "yellow") return compareColor
    return foreground
  }

  // ------------------------------------------------------------ cache & fetch

  function loadCache(raw) {
    var cached = Model.parseCache(raw, Date.now())
    if (!cached) return
    root.lastFetchMs = Math.max(root.lastFetchMs, cached.fetchedAt)
    root.lastAttemptMs = Math.max(root.lastAttemptMs, cached.attemptedAt)
    root.fetchFailures = Math.max(root.fetchFailures, cached.failures)
    Model.pollSeed(cached.fetchedAt, cached.attemptedAt, cached.failures)

    if (cached.report) {
      root.report = cached.report
      root.history = cached.history
      root.lastErrorMessage = cached.error
      root.errorText = cached.error
      root.nowMs = Date.now()
    } else if (cached.error !== "") {
      root.lastErrorMessage = cached.error
      root.errorText = cached.error
    }
  }

  function writeCache() {
    if (!root.cacheLoadAttempted) return
    cacheFile.setText(Model.serializeCache(
      root.report,
      root.history,
      root.lastFetchMs,
      root.lastAttemptMs,
      root.fetchFailures,
      root.lastErrorMessage
    ))
  }

  function nextAutoDelayMs() {
    var fetchedAt = Math.max(root.lastFetchMs, Model.pollState.fetchedAt)
    var attemptedAt = Math.max(root.lastAttemptMs, Model.pollState.attemptedAt)
    var failures = Math.max(root.fetchFailures, Model.pollState.failures)
    return Model.autoDelayMs(fetchedAt, attemptedAt, failures, root.refreshIntervalSec * 1000, Date.now())
  }

  function scheduleNextPoll(delayMs) {
    if (!root.pollLeader) return
    poll.interval = Math.max(250, Math.round(Number(delayMs) || 0))
    poll.restart()
  }

  function startPolling() {
    if (!root.cacheLoadAttempted || !root.settingsReady) {
      Qt.callLater(root.startPolling)
      return
    }
    root.scheduleNextPoll(root.nextAutoDelayMs())
  }

  function applyResult(result) {
    root.report = result.report || null
    root.history = result.history || Model.emptyHistory()
    root.lastFetchMs = Number(result.fetchedAt) || 0
    root.lastAttemptMs = Number(result.attemptedAt) || 0
    root.fetchFailures = Math.round(Number(result.failures) || 0)
    root.errorText = String(result.errorText || "")
    root.lastErrorMessage = String(result.error || "")
    root.nowMs = Date.now()
  }

  function publishResult(result) {
    root.applyResult(result)
    Model.pollPublish(root, result)
    root.writeCache()
    root.scheduleNextPoll(root.nextAutoDelayMs())
  }

  function handleSuccess(nextReport, now) {
    root.publishResult({
      report: nextReport,
      history: Model.advanceHistory(root.history, nextReport, now),
      fetchedAt: now,
      attemptedAt: now,
      failures: 0,
      errorText: "",
      error: ""
    })
  }

  function handleFailure(message, now) {
    var failures = Math.min(20, root.fetchFailures + 1)
    var dataPresent = root.report !== null
    root.publishResult({
      report: root.report,
      history: root.history,
      fetchedAt: root.lastFetchMs,
      attemptedAt: now,
      failures: failures,
      errorText: dataPresent ? "" : message,
      error: message
    })
  }

  function fetchCommand() {
    var command = Model.shellQuote(root.executable) + " " + Model.shellQuote(root.helperPath)
    if (root.authFile !== "") command += " --auth-file " + Model.shellQuote(root.authFile)
    return command
  }

  function spawnFetch() {
    root.gotOutput = false
    root.stderrText = ""
    root.lastAttemptMs = Date.now()
    root.writeCache()
    fetchProc.command = ["/bin/sh", "-lc", root.fetchCommand()]
    fetchProc.running = true
  }

  function requestFetch(kind) {
    if (!root.pollLeader || fetchProc.running) return

    var now = Date.now()
    if (root.lastAttemptMs > 0) {
      var gap = now - root.lastAttemptMs
      var minGap = kind === "manual" ? Model.FORCE_MIN_MS : Model.AUTO_MIN_MS
      if (gap < minGap) {
        if (kind === "manual") {
          manualCatchup.interval = Math.max(1000, Math.round(minGap - gap) + 250)
          manualCatchup.restart()
        } else {
          root.scheduleNextPoll(minGap - gap)
        }
        return
      }
    }

    if (kind === "auto") {
      var delay = root.nextAutoDelayMs()
      if (delay > 1500) {
        root.scheduleNextPoll(delay)
        return
      }
    }
    root.spawnFetch()
  }

  function refreshNow() {
    if (root.pollLeader) {
      root.requestFetch("manual")
      return
    }
    var leader = Model.pollLeaderInstance()
    if (leader && leader !== root) {
      try {
        if (typeof leader.refreshNow === "function") {
          leader.refreshNow()
          return
        }
      } catch (e) {}
    }
    if (Model.pollClaim(root, Date.now())) {
      root.pollLeader = true
      root.requestFetch("manual")
    }
  }

  function applyOutput(raw) {
    var parsed = Model.parseResult(raw, Date.now())
    if (parsed === null) {
      if (String(raw || "").trim() !== "") {
        root.errorText = "Unreadable response from the OpenRouter helper"
        root.lastErrorMessage = root.errorText
      }
      return
    }
    root.gotOutput = true
    if (parsed.ok === false) {
      root.handleFailure(parsed.error, Date.now())
      return
    }
    root.handleSuccess(parsed.report, Date.now())
  }

  function lastStderrLine() {
    var lines = root.stderrText.split("\n")
    for (var i = lines.length - 1; i >= 0; i--) {
      var line = String(lines[i] || "").trim()
      if (line !== "") return line.slice(0, 240)
    }
    return ""
  }

  Process {
    id: fetchProc
    running: false

    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.applyOutput(text)
    }

    stderr: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.stderrText = String(text || "").trim()
    }

    onExited: function(exitCode, exitStatus) {
      if (!root.gotOutput) {
        var line = root.lastStderrLine()
        var message = line !== ""
          ? line
          : (exitCode === 127 ? "node not found; set the Node executable in the widget settings"
            : "OpenRouter helper failed (exit " + exitCode + ")")
        root.handleFailure(message, Date.now())
      }
    }
  }

  FileView {
    id: cacheFile
    path: root.cachePath
    blockLoading: true
    watchChanges: false
    atomicWrites: true
    printErrors: false
    onLoaded: if (root.startupDone) root.loadCache(text())
    onLoadFailed: if (root.startupDone) root.loadCache("")
  }

  Process {
    id: cacheDirProc
    command: ["install", "-d", "-m", "700", root.cacheDir]
    running: true
  }

  Component.onCompleted: {
    root.loadCache(cacheFile.loaded ? cacheFile.text() : "")
    root.cacheLoadAttempted = true
    root.startupDone = true
    Qt.callLater(function() {
      root.settingsReady = true
      if (root.pollLeader) root.startPolling()
    })
  }

  Component.onDestruction: Model.pollRelease(root)

  Timer {
    id: poll
    repeat: false
    running: root.pollLeader
    triggeredOnStart: false
    onTriggered: root.requestFetch("auto")
  }

  Timer {
    id: manualCatchup
    repeat: false
    onTriggered: root.requestFetch("manual")
  }

  Timer {
    id: pollCoordination
    interval: 5000
    repeat: true
    running: true
    triggeredOnStart: true
    onTriggered: {
      var wasLeader = root.pollLeader
      root.pollLeader = Model.pollClaim(root, Date.now())
      if (root.pollLeader && !wasLeader) root.startPolling()
      if (root.pollLeader || wasLeader) return
      var shared = Model.pollConsume(root)
      if (shared && shared.seq > root.consumedSeq) {
        root.consumedSeq = shared.seq
        root.applyResult(shared)
      }
    }
  }

  Timer {
    interval: 30000
    running: root.opened
    repeat: true
    onTriggered: root.nowMs = Date.now()
  }

  onOpenedChanged: if (opened) {
    nowMs = Date.now()
    if (root.pollLeader) {
      if (root.report === null && !fetchProc.running) root.requestFetch("auto")
      else if (root.lastFetchMs > 0 && Date.now() - root.lastFetchMs > root.refreshIntervalSec * 1000) root.requestFetch("auto")
    }
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function openActivity() {
    Qt.openUrlExternally("https://openrouter.ai/activity")
  }

  function handleClick(buttonCode) {
    if (buttonCode === Qt.MiddleButton) root.refreshNow()
    else if (buttonCode === Qt.RightButton) {
      if (rightClickCommand !== "" && root.bar) root.bar.run(rightClickCommand)
      else root.openActivity()
    } else {
      root.toggle()
    }
  }

  ShellIpc {
    target: root.ipcTarget

    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): string { root.refreshNow(); return "ok" }
    function text(): string { return root.heroDetail }
  }

  // -------------------------------------------------------------------- bar

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    labelVisible: false
    hasVisualContent: true
    dimmed: root.report === null
    active: root.state.color === "critical"
    tooltipText: root.tooltipText
    fixedWidth: root.vertical ? -1 : Math.ceil(content.implicitWidth + button.scaledHorizontalMargin * 2)
    fixedHeight: root.vertical ? Math.ceil(content.implicitHeight + button.scaledVerticalPadding * 2) : -1

    onPressed: function(buttonCode) { root.handleClick(buttonCode) }

    Row {
      id: content
      anchors.centerIn: parent
      spacing: Style.space(5)

      OpenRouterMark {
        anchors.verticalCenter: parent.verticalCenter
        markSize: Style.bar.iconFont + 3
        color: root.foreground
      }

      Item {
        visible: root.state.mode === "meter" && root.showBarUsage
        anchors.verticalCenter: parent.verticalCenter
        width: Style.space(22)
        height: Style.space(3)

        Rectangle {
          anchors.fill: parent
          radius: height / 2
          color: root.track
        }

        Rectangle {
          width: Math.max(height, parent.width * root.state.percent / 100)
          height: parent.height
          radius: height / 2
          color: root.stateColor(root.state.color)

          Behavior on width {
            NumberAnimation { duration: Style.duration(160); easing.type: Easing.OutCubic }
          }
        }
      }

      Text {
        textFormat: Text.PlainText
        anchors.verticalCenter: parent.verticalCenter
        visible: root.state.mode === "dollars" && root.showBarUsage
        text: root.barText
        color: root.stateColor(root.state.color)
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        renderType: Text.NativeRendering
      }
    }
  }

  // ------------------------------------------------------------------ popup

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(360))
    contentHeight: panel.fittedContentHeight(panelColumn.implicitHeight, Style.space(640))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTextKey: function(text) {
        if (text === "r") root.refreshNow()
      }

      Flickable {
        id: panelFlick
        anchors.fill: parent
        contentWidth: width
        contentHeight: panelColumn.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height

        Column {
          id: panelColumn
          width: panelFlick.width
          spacing: Style.space(14)

          PanelHero {
            width: parent.width
            title: "OpenRouter"
            meta: root.heroMeta
            detail: root.heroDetail
            foreground: root.foreground
            fontFamily: root.fontFamily

            iconComponent: Component {
              OpenRouterMark {
                markSize: Style.font.display
                color: root.foreground
              }
            }

            trailingControl: Component {
              Row {
                spacing: Style.spacing.sm

                PanelActionButton {
                  iconText: "󰏌"
                  tooltipText: "Open OpenRouter activity"
                  foreground: root.foreground
                  fontFamily: root.fontFamily
                  onClicked: root.openActivity()
                }

                PanelActionButton {
                  iconText: "󰑐"
                  tooltipText: root.busy ? "Refreshing…" : "Refresh (r)"
                  foreground: root.foreground
                  fontFamily: root.fontFamily
                  enabled: !root.busy
                  onClicked: root.refreshNow()
                }
              }
            }
          }

          PanelSeparator {
            foreground: root.foreground
          }

          Column {
            visible: root.report === null
            width: parent.width
            spacing: Style.space(4)

            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: root.errorText !== "" ? "No OpenRouter data" : "Reading key"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.subtitle
              font.bold: true
            }

            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: root.errorText !== ""
                ? root.errorText
                : "Asking OpenRouter for the key's limit and current cycle."
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap
            }

            Text {
              textFormat: Text.PlainText
              visible: root.errorText !== ""
              width: parent.width
              text: "The widget reads the OpenRouter key already used by OpenCode; set OPENROUTER_API_KEY or the auth file in settings to override."
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap
            }
          }

          Column {
            visible: root.report !== null
            width: parent.width
            spacing: Style.space(7)

            PanelSectionHeader {
              foreground: root.foreground
              fontFamily: root.fontFamily
              text: "This cycle"
            }

            Item {
              width: parent.width
              implicitHeight: Math.max(cycleLabel.implicitHeight, cycleValue.implicitHeight)

              Text {
                id: cycleLabel
                textFormat: Text.PlainText
                text: "Spend"
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
              }

              Text {
                id: cycleValue
                textFormat: Text.PlainText
                text: root.report
                  ? (root.state.mode === "meter"
                    ? Model.formatCurrency(root.report.spend) + " of " + Model.formatCurrency(root.state.effectiveLimit)
                    : Model.formatCurrency(root.report.spend))
                  : ""
                color: root.stateColor(root.state.color)
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                font.bold: true
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
              }
            }

            Item {
              visible: root.state.mode === "meter" && root.report !== null
              width: parent.width
              implicitHeight: Math.max(Style.space(4), Math.round(Style.spacing.controlHeight * 0.14))

              Rectangle {
                id: meterTrack
                anchors.fill: parent
                radius: height / 2
                color: root.track
              }

              Rectangle {
                anchors.left: meterTrack.left
                anchors.verticalCenter: meterTrack.verticalCenter
                height: meterTrack.height
                radius: meterTrack.radius
                width: Math.max(height, meterTrack.width * root.state.percent / 100)
                color: root.stateColor(root.state.color)

                Behavior on width {
                  NumberAnimation { duration: Style.duration(160); easing.type: Easing.OutCubic }
                }
              }
            }

            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: root.report
                ? (root.report.limit !== null
                  ? "Key limit: " + Model.formatCurrency(root.report.limit) + " / " + Model.intervalName(root.report.resetInterval).toLowerCase()
                  : "No key limit")
                : ""
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }

            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: root.report ? root.resetLine() : ""
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }

            Text {
              textFormat: Text.PlainText
              width: parent.width
              visible: root.report !== null && root.report.limit === null
              text: root.noLimitNote()
              color: root.stateColor(root.state.color)
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap
            }
          }

          Column {
            visible: root.state.hasPrevious
            width: parent.width
            spacing: Style.space(5)

            PanelSeparator {
              foreground: root.foreground
            }

            PanelSectionHeader {
              foreground: root.foreground
              fontFamily: root.fontFamily
              text: "Previous cycle"
            }

            Item {
              width: parent.width
              implicitHeight: Math.max(prevLabel.implicitHeight, prevValue.implicitHeight)

              Text {
                id: prevLabel
                textFormat: Text.PlainText
                text: root.previousRange()
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
              }

              Text {
                id: prevValue
                textFormat: Text.PlainText
                text: Model.formatCurrency(root.state.previousSpend)
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                font.bold: true
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
              }
            }

            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: root.previousDelta()
              color: root.state.over ? root.stateColor("yellow") : root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }
          }

          Column {
            visible: root.showCredits && root.report !== null && root.report.credits !== null
            width: parent.width
            spacing: Style.space(5)

            PanelSeparator {
              foreground: root.foreground
            }

            PanelSectionHeader {
              foreground: root.foreground
              fontFamily: root.fontFamily
              text: "Account credits"
            }

            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: root.report && root.report.credits
                ? Model.formatCurrency(root.report.credits.remaining) + " remaining"
                : ""
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              elide: Text.ElideRight
            }

            Text {
              textFormat: Text.PlainText
              width: parent.width
              text: root.report && root.report.credits
                ? Model.formatCurrency(root.report.credits.total) + " total · "
                  + Model.formatCurrency(root.report.credits.used) + " used"
                : ""
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }
          }

          Text {
            textFormat: Text.PlainText
            width: parent.width
            text: root.footerText
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            elide: Text.ElideRight
          }
        }
      }
    }
  }

  // --------------------------------------------------------------- formatting

  readonly property var locale: Qt.locale(Commons.I18n.formatLocale)

  function clockAt(ms) {
    var target = Number(ms) || 0
    if (target <= 0) return ""
    var date = new Date(target)
    var now = new Date()
    var sameDay = date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate()
    return date.toLocaleString(root.locale, sameDay ? "HH:mm" : "d MMM HH:mm")
  }

  function dateAt(ms) {
    var target = Number(ms) || 0
    if (target <= 0) return ""
    return new Date(target).toLocaleString(root.locale, "d MMM")
  }

  function resetLine() {
    if (!root.report) return ""
    if (root.report.resetsAt <= 0) return "No reset for this key limit"
    var reset = Model.resetText(root.report.resetsAt, root.nowMs)
    var clock = root.clockAt(root.report.resetsAt)
    return clock !== "" ? reset + " (" + clock + ")" : reset
  }

  function previousRange() {
    var prev = root.history ? root.history.previous : null
    if (!prev) return "Previous cycle"
    var start = root.dateAt(prev.start)
    var end = root.dateAt(prev.end)
    if (start === "" || end === "") return "Previous cycle"
    return start + " – " + end
  }

  function previousDelta() {
    var prev = root.history ? root.history.previous : null
    if (!prev || !root.report) return ""
    var delta = root.report.spend - prev.spend
    if (delta > 0) return Model.formatCurrency(delta) + " over the previous cycle"
    if (delta < 0) return Model.formatCurrency(-delta) + " under the previous cycle"
    return "At the previous cycle's spend"
  }

  function noLimitNote() {
    if (!root.report || root.report.limit !== null) return ""
    if (!root.state.hasPrevious) {
      return "No key limit; showing spend. A bar appears after one full cycle has been recorded."
    }
    if (root.state.over) {
      return "Over the previous cycle; showing spend instead of a bar."
    }
    if (root.state.previousSpend === 0) {
      return "Previous cycle spent $0.00, so there is no non-zero baseline bar yet."
    }
    return "Using the previous cycle (" + Model.formatCurrency(root.state.previousSpend) + ") as the limit."
  }
}
