const express = require("express");
const puppeteer = require("puppeteer");
const proxyChain = require("proxy-chain");
const cors = require("cors");
const axios = require("axios");

const app = express();

// CORS configuration - Replace with your actual website URL
app.use(cors({
    origin: "https://www.yourwebsite.com",  // Replace with your actual domain
    methods: ["POST"],
    credentials: true
}));

app.use(express.json());

// Environment variables
const PROXY_HOST = process.env.PROXY_HOST || "gw.dataimpulse.com";
const PROXY_PORT = process.env.PROXY_PORT || 823;
const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

async function getLocationByZip(zipCode) {
    try {
        const response = await axios.get(`http://api.zippopotam.us/us/${zipCode}`);
        if (response.status === 200) {
            const data = response.data;
            const city = data.places[0]?.["place name"]?.replace(" ", "").toLowerCase() || null;
            const state = data.places[0]?.["state"]?.replace(" ", "").toLowerCase() || null;
            return { city, state };
        }
    } catch (error) {
        console.error("Error fetching location data:", error.message);
        return { city: null, state: null };
    }
}

function createProxyUrl(zipCode, city, state) {
    if (state) {
        return `http://${PROXY_USER}__cr.us;state.${state}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;
    } else if (city) {
        return `http://${PROXY_USER}__cr.us;city.${city}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;
    } else {
        return `http://${PROXY_USER}__cr.us:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;
    }
}

app.post("/submit-benefit-form", async (req, res) => {
    const { firstName, lastName, phone, email, age, zip } = req.body;
    let proxyChainUrl = null;
    let browser = null;

    try {
        const location = await getLocationByZip(zip);
        const proxyUrl = createProxyUrl(zip, location.city, location.state);
        proxyChainUrl = await proxyChain.anonymizeProxy(proxyUrl);

        browser = await puppeteer.launch({
            args: [`--proxy-server=${proxyChainUrl}`, "--disable-sync"],
            headless: true
        });

        const page = await browser.newPage();
        await page.goto("https://benefit-guidance.com", { 
            waitUntil: "networkidle0",
            timeout: 60000 
        });

        // Fill form
        await page.type("#firstName", firstName);
        await page.type("#lastName", lastName);
        await page.type("#phone", phone);
        await page.type("#email", email);
        await page.type("#age", age);
        await page.type("#zip", zip);
        
        await page.click("#leadid_tcpa_disclosure");
        await page.click("#submit");
        
        await new Promise(resolve => setTimeout(resolve, 3000));

        await browser.close();
        
        if (proxyChainUrl) {
            const { hostname, port } = new URL(proxyChainUrl);
            await proxyChain.closeTunnel(`${hostname}:${port}`);
            await proxyChain.closeAnonymizedProxy(proxyChainUrl, true);
        }

        res.status(200).json({ message: "Form submitted successfully" });
    } catch (error) {
        console.error("Error:", error);

        if (browser) await browser.close();
        
        if (proxyChainUrl) {
            try {
                const { hostname, port } = new URL(proxyChainUrl);
                await proxyChain.closeTunnel(`${hostname}:${port}`);
                await proxyChain.closeAnonymizedProxy(proxyChainUrl, true);
            } catch (closeError) {
                console.error("Error closing proxy:", closeError);
            }
        }

        res.status(500).json({ 
            message: "Error submitting form",
            error: error.message 
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
