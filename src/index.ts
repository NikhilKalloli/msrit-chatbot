import type { TextBlock } from '@anthropic-ai/sdk/resources';
import Anthropic from '@anthropic-ai/sdk';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { methodOverride } from 'hono/method-override'
 
// @ts-expect-error
import notes from './notes.html'
// @ts-expect-error
import ui from './ui.html'
// @ts-expect-error
import write from './write.html'

type Env = {
	AI: Ai;
	ANTHROPIC_API_KEY: string;
	DATABASE: D1Database;
	ENABLE_TEXT_SPLITTING: boolean | undefined;
	RAG_WORKFLOW: Workflow;
	VECTOR_INDEX: VectorizeIndex
};

type Note = {
	id: string;
	text: string;
	created_at: string;
}

type Params = {
	text: string;
};

const app = new Hono<{ Bindings: Env }>()
app.use(cors())

app.get('/notes.json', async (c) => {
	const query = `SELECT * FROM notes`
	const { results } = await c.env.DATABASE.prepare(query).all()
	return c.json(results);
})

app.get('/notes', async (c) => {
	return c.html(notes);
})

app.use('/notes/:id', methodOverride({ app }))
app.delete('/notes/:id', async (c) => {
	const { id } = c.req.param();
	const query = `DELETE FROM notes WHERE id = ?`
	await c.env.DATABASE.prepare(query).bind(id).run()
	await c.env.VECTOR_INDEX.deleteByIds([id])
	return c.redirect('/notes')
})

app.post('/notes', async (c) => {
	const { text } = await c.req.json();
	if (!text) return c.text("Missing text", 400);
	await c.env.RAG_WORKFLOW.create({ params: { text } })
	return c.text("Created note", 201);
})

app.get('/ui', async (c) => {
	return c.html(ui);
})

app.get('/write', async (c) => {
	return c.html(write);
})

app.get('/', async (c) => {
	const question = c.req.query('text') || "What is the square root of 9?"

	const embeddings = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', { text: question })
	const vectors = embeddings.data[0]
	console.log('Query embeddings:', vectors.length)

	const vectorQuery = await c.env.VECTOR_INDEX.query(vectors, { topK: 3 });
	console.log('Vector query parameters:', {
		vectorLength: vectors.length,
		topK: 3
	});
	console.log('Raw vector query result:', vectorQuery);
	console.log('Vector matches:', vectorQuery.matches)
	const vecIds = vectorQuery.matches.map(match => match.id);
	console.log('Retrieved note IDs:', vecIds)

	let notes: string[] = []
	if (vecIds.length > 0) {
		const query = `SELECT * FROM notes WHERE id IN (${vecIds.map(() => '?').join(',')})`
		console.log('SQL Query:', query)
		const { results } = await c.env.DATABASE.prepare(query).bind(...vecIds).all<Note>()
		console.log('Database results:', results)
		if (results) notes = results.map(note => note.text)
	}

	const contextMessage = notes.length
		? `Context:\n${notes.map(note => `- ${note}`).join("\n")}`
		: ""
	console.log('Final context message:', contextMessage)

	const systemPrompt = `You're a helpful chatbot for MSRIT college. 
	You will give insights about the MSRIT college. Don't answer questions that are not about MSRIT college.
	When answering the question or responding, use the context provided, if it is provided and relevant.`

	let modelUsed: string = ""
	let response: AiTextGenerationOutput | Anthropic.Message

	if (c.env.ANTHROPIC_API_KEY) {
		const anthropic = new Anthropic({
			apiKey: c.env.ANTHROPIC_API_KEY
		})

		const model = "claude-3-5-sonnet-latest"
		modelUsed = model

		const message = await anthropic.messages.create({
			max_tokens: 1024,
			model,
			messages: [
				{ role: 'user', content: question }
			],
			system: contextMessage ? `${systemPrompt}\n\n${contextMessage}` : systemPrompt
		})
		console.log('System prompt sent to model:', contextMessage ? `${systemPrompt}\n\n${contextMessage}` : systemPrompt)

		response = {
			response: (message.content as TextBlock[]).map(content => content.text).join("\n")
		}
	} else {
		const model = "@cf/meta/llama-3.1-8b-instruct"
		modelUsed = model

		response = await c.env.AI.run(
			model,
			{	
				messages: [
					...(notes.length ? [{ role: 'system', content: contextMessage }] : []),
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: question }
				] as RoleScopedChatInput[]
			}
		) as AiTextGenerationOutput
	}

	if (response) {
		c.header('x-model-used', modelUsed)
		return c.text((response as any).response)
	} else {
		return c.text("We were unable to generate output", 500)
	}
})

app.get('/debug/vectors', async (c) => {
	try {
		// Get all notes from database
		const { results } = await c.env.DATABASE.prepare('SELECT * FROM notes').all<Note>();
		console.log('All notes in database:', results);
		
		// For each note, check if it exists in vector store
		const vectorChecks = await Promise.all(
			results.map(async (note) => {
				const embedding = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', { text: note.text });
				const vectors = embedding.data[0];
				const vectorQuery = await c.env.VECTOR_INDEX.query(vectors, { topK: 1 });
				return {
					noteId: note.id,
					text: note.text,
					hasVector: vectorQuery.matches.length > 0,
					matches: vectorQuery.matches
				};
			})
		);
		
		return c.json({
			noteCount: results.length,
			vectorChecks
		});
	} catch (error:any) {
		console.error('Debug endpoint error:', error);
		return c.json({ error: error.message }, 500);
	}
});

app.get('/debug/clear', async (c) => {
	try {
		// Clear all notes
		await c.env.DATABASE.prepare('DELETE FROM notes').run();
		// Vector store doesn't have a clear method, but deleting notes should be enough
		return c.json({ message: 'Cleared all notes' });
	} catch (error:any) {
		console.error('Clear error:', error);
		return c.json({ error: error.message }, 500);
	}
});

app.get('/debug/migrate', async (c) => {
	try {
		// Drop existing tables
		await c.env.DATABASE.prepare('DROP TABLE IF EXISTS notes').run();
		
		// Create notes table with proper schema
		await c.env.DATABASE.prepare(`
			CREATE TABLE notes (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				text TEXT NOT NULL,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`).run();
		
		return c.json({ message: 'Migration completed successfully' });
	} catch (error: any) {
		console.error('Migration error:', error);
		return c.json({ error: error.message }, 500);
	}
});

export class RAGWorkflow extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		const env = this.env
		const { text } = event.payload;
		console.log('Processing new note:', text)
		let texts: string[] = [text]

		if (env.ENABLE_TEXT_SPLITTING) {
			texts = await step.do('split text', async () => {
				const splitter = new RecursiveCharacterTextSplitter({
					chunkSize: 500,  // Smaller chunks for more precise matching
					chunkOverlap: 50,  // Some overlap to maintain context between chunks
					separators: ["\n\n", "\n", " ", ""] // Custom separators for better splitting
				});
				const output = await splitter.createDocuments([text]);
				return output.map(doc => doc.pageContent);
			})

			console.log(`Text split into ${texts.length} chunks:`, texts)
		}

		for (const index in texts) {
			const text = texts[index]
			console.log(`Processing chunk ${index}:`, text)
			
			const record = await step.do(`create database record: ${index}/${texts.length}`, async () => {
				const query = "INSERT INTO notes (text) VALUES (?) RETURNING id, text, created_at"
				const { results } = await env.DATABASE.prepare(query)
					.bind(text)
					.run<Note>()

				const record = results[0]
				console.log('Created database record:', record)
				if (!record) throw new Error("Failed to create note")
				return record;
			})

			const embedding = await step.do(`generate embedding: ${index}/${texts.length}`, async () => {
				console.log('Generating embedding for text:', text)
				const embeddings = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: text })
				console.log('Raw embeddings response:', embeddings)
				const values = embeddings.data[0]
				console.log('Generated embedding length:', values?.length)
				if (!values) throw new Error("Failed to generate vector embedding")
				return values
			})

			await step.do(`insert vector: ${index}/${texts.length}`, async () => {
				console.log('Attempting to insert vector:', {
					id: record.id.toString(),
					valueLength: embedding.length
				})
				const result = await env.VECTOR_INDEX.upsert([
					{
						id: record.id.toString(),
						values: embedding,
					}
				]);
				console.log('Vector insertion result:', result)
				return result;
			})
		}
	}
}

export default app
