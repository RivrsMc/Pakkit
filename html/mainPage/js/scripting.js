let sharedVars

export function updateScript(fromCheckbox) {
  if (!((fromCheckbox === true) || document.getElementById('enableScripting').checked)) return
  sharedVars.ipcRenderer.send('scriptStateChange', JSON.stringify({ //
    scriptingEnabled: document.getElementById('enableScripting').checked,
    script: window.scriptEditor.getDoc().getValue()
  }))
}

export function setup(passedSharedVars) {
  sharedVars = passedSharedVars

  const defaultScript = `// See the node-minecraft-protocol docs
// When editing your scripts, disable scripting or disconnect so
// you don't get lots of errors.

// Scripts won't automatically save (yet), so make sure to save
// them somewhere!

// Handles packets going from the client to the server
exports.upstreamHandler = function (meta, data, server, client) {
  /* if (meta.name === 'chat') {
    data.message = 'modified'
  } */
  server.sendPacket(meta, data)
}

// Handles packets going from the server to the client
exports.downstreamHandler = function (meta, data, server, client) {
  client.sendPacket(meta, data)
}`
  window.resetScriptEditor = function () {
    // document.getElementById('scriptEditor').value = defaultScript
    window.scriptEditor.getDoc().setValue(defaultScript)
    // reset save button
    // todo: maybe confirm dialog, if there are unsaved changes?
    document.getElementById('btnScriptSave').disabled = true
    document.getElementById('btnScriptSave').title = ''
  }
  window.scriptEditor = CodeMirror.fromTextArea(document.getElementById('scriptEditor'), { // window. stops standardjs from complaining
    lineNumbers: true,
    autoCloseBrackets: true,
    theme: 'darcula',
    autoRefresh: true
  })
  resetScriptEditor()

  window.scriptEditor.on('change', updateScript)
}
