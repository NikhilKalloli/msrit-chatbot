import requests
import json
from dotenv import load_dotenv
import os
import re
import time
from urllib.parse import urlparse

load_dotenv()

CLOUDFLARE_ACCOUNT_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID")
CLOUDFLARE_API_TOKEN = os.getenv("CLOUDFLARE_API_TOKEN")

if not CLOUDFLARE_ACCOUNT_ID or not CLOUDFLARE_API_TOKEN:
    print("❌ Error: CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN not found in environment variables.")
    exit(1)

def get_markdown_content(url: str, retries=3, delay=5):
    api_url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/browser-rendering/markdown"
    headers = {
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type": "application/json"
    }
    body = json.dumps({ "url": url })

    for attempt in range(retries):
        try:
            response = requests.post(api_url, headers=headers, data=body)
            data = response.json()

            if data.get("success"):
                return data.get("result")

            # Check for rate limit error code
            errors = data.get('errors', [])
            is_rate_limit = any(e.get('code') == 2001 for e in errors)

            if is_rate_limit:
                wait_time = delay * (2 ** attempt) # Exponential backoff
                print(f"⚠️ Rate limit hit for {url}. Retrying in {wait_time}s... (Attempt {attempt + 1}/{retries})")
                time.sleep(wait_time)
                continue
            
            error_message = f"❌ Error from API for {url}: {json.dumps(errors, indent=2)}"
            print(error_message)
            return None

        except Exception as e:
            print(f"⚠️ Exception getting markdown for {url}: {e}")
            return None
            
    print(f"❌ Failed to get content for {url} after {retries} retries")
    return None

def get_all_hyperlinks(url: str):
    try:
        api_url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/browser-rendering/links"
        headers = {
            "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
            "Content-Type": "application/json"
        }
        body = json.dumps({ "url": url })
        response = requests.post(api_url, headers=headers, data=body)
        data = response.json()

        if not data.get("success"):
            error_message = f"❌ Error extracting links for {url}: {json.dumps(data.get('errors', data), indent=2)}"
            print(error_message)
            return None

        return data.get("result")

    except Exception as e:
        print(f"⚠️ Exception getting hyperlinks for {url}: {e}")
        return None

def sanitize_filename(url):
    """Generates a safe filename from a URL."""
    parsed = urlparse(url)
    path = parsed.path.strip("/")
    if not path:
        return "home.md"
    
    # Replace non-alphanumeric characters with underscores
    filename = re.sub(r'[^a-zA-Z0-9]', '_', path)
    return f"{filename}.md"

def main():
    base_url = "https://msrit.edu"
    print(f"🔍 Fetching links from {base_url}...")
    
    links = get_all_hyperlinks(base_url)
    
    if not links:
        print("❌ No links found or error occurred.")
        return

    print(f"✅ Found {len(links)} links. Starting markdown extraction...")
    
    # Ensure data directory exists
    os.makedirs("data", exist_ok=True)
    
    unique_links = set(links)
    total_links = len(unique_links)
    
    for i, link in enumerate(unique_links):
        print(f"⏳ [{i+1}/{total_links}] Processing: {link}")
        
        if not link.startswith("http"):
            print(f"⏭️ Skipping non-http link: {link}")
            continue

        content = get_markdown_content(link)
        
        if content:
            filename = sanitize_filename(link)
            filepath = os.path.join("data", filename)
            
            counter = 1
            base_filepath = filepath
            while os.path.exists(filepath):
                filepath = base_filepath.replace(".md", f"_{counter}.md")
                counter += 1
            
            try:
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(f"Source: {link}\n\n")
                    f.write(content)
                print(f"💾 Saved to {filepath}")
            except Exception as e:
                print(f"❌ Error writing file {filepath}: {e}")
        # else:
            # print(f"⚠️ Failed to get content for {link}")

        # Standard delay between requests
        time.sleep(5)

    print("\n🎉 Scraping completed!")

if __name__ == "__main__":
    main()
