// istanbul ignore next
import { createConnection, ProposedFeatures, TextDocumentSyncKind, Range, FoldingRange, FoldingRangeKind, SignatureInformation } from 'vscode-languageserver'
import { GlobalCache } from './types/Cache'
import { VanillaConfig } from './types/Config'
import ArgumentParserManager from './parsers/ArgumentParserManager'
import Line from './types/Line'
import LineParser from './parsers/LineParser'
import StringReader from './utils/StringReader'
import { SignatureHelp } from 'vscode'

const connection = createConnection(ProposedFeatures.all)
const linesOfUri = new Map<string, Line[]>()
const stringsOfUri = new Map<string, string[]>()

const cache: GlobalCache = {}
const config = VanillaConfig
const manager = new ArgumentParserManager()

const lineParser = new LineParser(false, 'line', undefined, cache, config)

connection.onInitialize(params => {
    params.workspaceFolders
    return {
        capabilities: {
            completionProvider: {
                triggerCharacters: [' ', ',', '{', '[', '=', ':', '/', '@', '\n', '!', "'", '"']
            },
            // definitionProvider: true,
            // documentFormattingProvider: true,
            // documentLinkProvider: {
            //     resolveProvider: true
            // },
            // documentOnTypeFormattingProvider: {
            //     firstTriggerCharacter: '\n'
            // },
            foldingRangeProvider: true,
            // hoverProvider: true,
            // referencesProvider: true,
            // renameProvider: {
            //     prepareProvider: true
            // },
            signatureHelpProvider: {
                triggerCharacters: [' ', '\n']
            },
            textDocumentSync: {
                change: TextDocumentSyncKind.Incremental,
                openClose: true
            }
        }
    }
})

function parseString(string: string, lines: Line[]) {
    if (string.match(/^\s*$/)) {
        lines.push({ args: [], hint: { fix: [], options: [] } })
    } else {
        const reader = new StringReader(string)
        const { data } = lineParser.parse(reader, undefined, manager)
        lines.push(data)
    }
}

function updateDiagnostics(uri: string) {
    const lines = linesOfUri.get(uri) as Line[]
    const diagnostics = []
    let lineNumber = 0
    for (const line of lines) {
        if (line.errors) {
            diagnostics.push(...line.errors.map(v => v.toDiagnostic(lineNumber)))
        }
        lineNumber++
    }
    connection.sendDiagnostics({ uri, diagnostics })
}

connection.onDidOpenTextDocument(({ textDocument: { text, uri } }) => {
    const lines: Line[] = []
    const strings = text.split('\n')
    for (const string of strings) {
        parseString(string, lines)
    }
    linesOfUri.set(uri, lines)
    stringsOfUri.set(uri, strings)
    updateDiagnostics(uri)
})
connection.onDidChangeTextDocument(({ contentChanges, textDocument: { uri } }) => {
    for (const change of contentChanges) {
        const { text: changeText } = change
        const {
            start: { line: startLine, character: startChar },
            end: { line: endLine, character: endChar }
        } = change.range as Range
        const strings = stringsOfUri.get(uri) as string[]
        const lines = linesOfUri.get(uri) as Line[]

        const stringAfterStartLine = `${strings[startLine].slice(0, startChar)
            }${changeText
            }${strings.slice(endLine).join('\n').slice(endChar)}`
        const stringsAfterStartLine = stringAfterStartLine.split('\n')

        strings.splice(startLine)
        strings.push(...stringsAfterStartLine)

        lines.splice(startLine)
        for (const string of stringsAfterStartLine) {
            parseString(string, lines)
        }
    }
    updateDiagnostics(uri)
})
connection.onDidCloseTextDocument(({ textDocument: { uri } }) => {
    linesOfUri.delete(uri)
    stringsOfUri.delete(uri)
})

connection.onCompletion(({ textDocument: { uri }, position: { line, character } }) => {
    const strings = stringsOfUri.get(uri) as string[]
    const reader = new StringReader(strings[line])
    const { data } = lineParser.parse(reader, character, manager)
    return data.completions
})

connection.onFoldingRanges(({ textDocument: { uri } }) => {
    const strings = stringsOfUri.get(uri) as string[]
    const startLineNumbers: number[] = []
    const foldingRanges: FoldingRange[] = []
    let i = 0
    for (const string of strings) {
        if (string.startsWith('#region')) {
            startLineNumbers.push(i)
        } else if (string.startsWith('#endregion')) {
            const startLineNumber = startLineNumbers.pop()
            if (startLineNumber !== undefined) {
                foldingRanges.push(FoldingRange.create(startLineNumber, i, undefined, undefined, FoldingRangeKind.Region))
            }
        }
        i += 1
    }
    return foldingRanges
})

connection.onSignatureHelp(({ position: { character: char, line: lineNumber }, textDocument: { uri } }) => {
    const strings = stringsOfUri.get(uri) as string[]
    const reader = new StringReader(strings[lineNumber])
    const { data: { hint: { fix, options } } } = lineParser.parse(reader, char, manager)

    const fixLabelBeginning = fix.length > 1 ? fix.slice(0, -1).join(' ') + ' ' : ''
    const fixLabelLast = fix[fix.length - 1]
    const signatures: SignatureInformation[] = []
    const nonEmptyOptions = options.length > 0 ? options : ['']

    for (const option of nonEmptyOptions) {
        signatures.push({
            label: `${fixLabelBeginning}${fixLabelLast} ${option}`,
            parameters: [
                {
                    label: [
                        0,
                        fixLabelBeginning.length
                    ]
                },
                {
                    label: [
                        fixLabelBeginning.length,
                        fixLabelBeginning.length + fixLabelLast.length
                    ]
                },
                {
                    label: [
                        fixLabelBeginning.length + fixLabelLast.length,
                        fixLabelBeginning.length + fixLabelLast.length + option.length
                    ]
                }
            ]
        })
    }

    return { signatures, activeParameter: 1, activeSignature: 0 }
})

// connection.onColorPresentation(({ color, range, textDocument: { uri } }) => {

// })

connection.listen()
