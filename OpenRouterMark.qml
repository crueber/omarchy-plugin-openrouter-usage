import QtQuick
import QtQuick.Shapes

// The OpenRouter mark, traced from the official glyph served at
// https://openrouter.ai/brand/v2/openrouter-glyph-light.svg. Drawn as a vector
// so it follows the theme foreground and stays crisp at bar sizes.
Item {
  id: root

  property real markSize: 16
  property color color: "white"

  readonly property real aspect: 401.4 / 293.7

  implicitWidth: Math.round(markSize * aspect)
  implicitHeight: markSize
  width: implicitWidth
  height: implicitHeight

  Shape {
    width: 401.4
    height: 293.7
    scale: root.markSize / 293.7
    transformOrigin: Item.TopLeft
    antialiasing: true

    ShapePath {
      fillColor: root.color
      strokeColor: "transparent"
      PathSvg {
        path: "M303.9475,17.19926c42.79734,0,77.48933,34.69327,77.48933,77.48933s-34.69199,77.48933-77.48933,77.48933l76.86166,76.86244c9.76367,9.76313,2.84903,26.45667-10.95697,26.45667h-220.88335c-71.32686,0-129.14889-57.82202-129.14889-129.14889S77.64197,17.19926,148.96884,17.19926h154.97866ZM148.96884,68.85881c-42.79607,0-77.48933,34.69327-77.48933,77.48933s34.69327,77.48933,77.48933,77.48933,77.48933-34.69327,77.48933-77.48933-34.69327-77.48933-77.48933-77.48933Z"
      }
    }
  }
}
