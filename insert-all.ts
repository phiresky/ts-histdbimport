#!/usr/bin/env node
import Sqlite from "better-sqlite3"
import { createReadStream } from "fs"
import { hostname } from "os"
import { join } from "path"
import { createInterface } from "readline"

const homeDir = process.env.HOME
if (!homeDir) throw Error("no home dir")

const hostName = process.env.host || hostname()

// don't know these
const sessionNum = "-1"
const returnValue = "-1"
const runDir = join(homeDir, "unknown")

const databaseFile =
	process.env.database || join(homeDir, ".histdb/zsh-history.db")
const historyFile = process.env.history_file || join(homeDir, ".zsh_history")

type Entry = {
	started: string
	duration: string
	command: string
}
interface FullEntry extends Entry {
	session: string
	returnValue: string
	host: string
	dir: string
}
async function* readEntries() {
	// read whole file so we can split it by '\n'
	const history = await (async function () {
		const history_stream = createReadStream(historyFile)

		let history_data_chunks = []
		for await (let data_chunk of history_stream) {
			history_data_chunks.push(data_chunk)
		}

		return Buffer.concat(history_data_chunks).toString()
	})()

	let entry = ""
	let last_char = ""
	let line = 0
	for await (const char of history) {
		if (char == "\n") {
			line += 1
		}

		// if the current char is a newline that it isn't escaped then we are
		// at the end of the history entry so parse it into a Entry object,
		// return it, and reset out state
		if (char == "\n" && last_char != "\\") {
			const history_entry_regex = /^: (?<started>\d+):(?<duration>\d+);(?<command>[\s\S]*)$/

			const result = history_entry_regex.exec(entry)

			// the regex didn't match on the history entry
			if (result == null) {
				console.log(result)
				throw Error(
					`invalid history syntax on line ${line} in ${historyFile}: \n"${entry}"`,
				)
			}

			yield result.groups as Entry

			entry = ""
			last_char = ""
		} else {
			entry += char
		}

		last_char = char
	}
}
async function readHistory() {
	console.log(`importing history from "${historyFile} into "${databaseFile}"`)
	const db = new Sqlite(databaseFile) //, { verbose: console.log })
	db.exec("pragma foreign_keys = off")
	db.prepare("insert into places (host,dir) values (?,?)").run(
		hostName,
		runDir,
	)

	const commandInsert = db.prepare(
		"insert into commands (argv) values (@command)",
	)
	const historyInsert = db.prepare(`INSERT INTO history
        (session, command_id, place_id, exit_status, start_time, duration)
        SELECT @session, commands.rowid, places.rowid, @returnValue, @started, @duration
        FROM commands, places
        WHERE commands.argv = @command AND places.host = @host AND places.dir = @dir`)

	console.time("took")
	db.exec("BEGIN")
	let count = 0
	for await (const entry of readEntries()) {
		const fullEntry: FullEntry = {
			...entry,
			session: sessionNum,
			returnValue,
			dir: runDir,
			host: hostName,
		}
		commandInsert.run(fullEntry)
		historyInsert.run(fullEntry)
		count++
	}
	db.exec("COMMIT")
	console.timeEnd("took")
	console.log(`inserted ${count} history entries`)
}

readHistory()
