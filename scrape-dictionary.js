- name: Install Chromium and puppeteer-core
        run: |
          sudo apt-get update -q
          sudo apt-get install -y chromium-browser 2>/dev/null || sudo apt-get install -y chromium
          npm install puppeteer-core

      - name: Run scraper
        run: node scrape-dictionary.js
