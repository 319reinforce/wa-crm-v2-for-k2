/**
 * 测试 timicc.com OpenAI 兼容 API
 */

const API_KEY = process.env.TIMICC_API_KEY || process.env.OPENAI_API_KEY;
const BASE_URL = 'https://timicc.com';
const MODEL = 'gpt-5.4';

async function testTimiccAPI() {
    console.log('🧪 Testing timicc.com API...');
    console.log(`📍 Base URL: ${BASE_URL}`);
    console.log(`🤖 Model: ${MODEL}`);
    console.log(`🔑 API Key: ${API_KEY ? `${API_KEY.slice(0, 10)}...` : 'NOT SET'}`);
    console.log('');

    if (!API_KEY) {
        console.error('❌ API Key not found. Set TIMICC_API_KEY or OPENAI_API_KEY environment variable.');
        process.exit(1);
    }

    const testMessages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Say "Hello from timicc API!" in Chinese.' }
    ];

    try {
        console.log('📤 Sending request...');
        const startTime = Date.now();

        const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
            },
            body: JSON.stringify({
                model: MODEL,
                messages: testMessages,
                max_tokens: 100,
                temperature: 0.7,
            }),
        });

        const latency = Date.now() - startTime;
        console.log(`⏱️  Latency: ${latency}ms`);
        console.log(`📊 Status: ${response.status} ${response.statusText}`);
        console.log('');

        const data = await response.json();

        if (!response.ok) {
            console.error('❌ API Error:');
            console.error(JSON.stringify(data, null, 2));
            process.exit(1);
        }

        console.log('✅ Success!');
        console.log('');
        console.log('📦 Response:');
        console.log(JSON.stringify(data, null, 2));
        console.log('');

        const content = data.choices?.[0]?.message?.content;
        if (content) {
            console.log('💬 Generated Text:');
            console.log(content);
            console.log('');
        }

        console.log('📈 Usage:');
        console.log(`  Prompt tokens: ${data.usage?.prompt_tokens || 'N/A'}`);
        console.log(`  Completion tokens: ${data.usage?.completion_tokens || 'N/A'}`);
        console.log(`  Total tokens: ${data.usage?.total_tokens || 'N/A'}`);
        console.log('');

        console.log('✅ timicc.com API is working correctly!');
        return true;

    } catch (error) {
        console.error('❌ Request failed:');
        console.error(error.message);
        if (error.cause) {
            console.error('Cause:', error.cause);
        }
        process.exit(1);
    }
}

testTimiccAPI().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
