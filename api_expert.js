export class ExpertAPI {
    constructor(apiKey, expertId, environment = 'production') {
        this.apiKey = apiKey;
        this.expertId = expertId;
        this.baseUrl = environment === 'production' 
            ? 'https://knowledge.alpha.insea.io/api' 
            : 'https://knowledge.alpha.test.insea.io/api';
    }

    async _fetch(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Authorization': `Bearer ${this.apiKey}`,
            ...options.headers
        };

        const isFormData = options.body instanceof FormData;
        if (!isFormData && options.method !== 'GET' && options.method !== 'DELETE') {
            headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        }

        const response = await fetch(url, { ...options, headers });
        
        if (!response.ok) {
            let errorMsg = response.statusText;
            try {
                const textBody = await response.text();
                try {
                    const errorData = JSON.parse(textBody);
                    errorMsg = JSON.stringify(errorData);
                } catch {
                    errorMsg = textBody;
                }
            } catch (e) {
                errorMsg = "Failed to parse error body";
            }
            throw new Error(`API Request failed (${response.status}): ${errorMsg}`);
        }

        // For DELETE requests or empty responses
        if (response.status === 204 || response.headers.get('content-length') === '0') {
            return true;
        }

        if (options.stream) {
            return response.body; 
        }

        return response.json();
    }

    /**
     * Chat Completion (v2)
     * Creates a chat completion for the given conversation messages.
     * @param {Array} messages - List of messages [{role: 'user', content: '...'}]
     * @param {string} userId - Unique identifier for the end-user
     * @param {Object} options - Optional { stream: boolean, tags: array, tagFilterMode: string, folderIds: array }
     */
    async chatCompletion(messages, userId, options = {}) {
        const payload = {
            messages: messages,
            user: userId,
            stream: options.stream || false,
        };
        
        if (options.tags) payload.tags = options.tags;
        if (options.tagFilterMode) payload.tagFilterMode = options.tagFilterMode;
        if (options.folderIds) payload.folderIds = options.folderIds;

        return this._fetch(`/experts/${this.expertId}/v2/chat/completions`, {
            method: 'POST',
            body: JSON.stringify(payload),
            stream: payload.stream
        });
    }

    // =====================================
    // KNOWLEDGE MANAGEMENT
    // =====================================

    /** Retrieves all knowledge entries for a specific expert. */
    async listKnowledges() {
        return this._fetch(`/experts/${this.expertId}/knowledges`, { method: 'GET' });
    }

    /** Deletes a specific knowledge entry. */
    async deleteKnowledge(knowledgeId) {
        return this._fetch(`/experts/${this.expertId}/knowledges/${knowledgeId}`, { method: 'DELETE' });
    }

    /** Uploads a new knowledge entry or updates an existing one. */
    async addKnowledge(file, options = {}) {
        const formData = new FormData();
        formData.append('file', file);
        if (options.knowledgeId) formData.append('knowledgeId', options.knowledgeId);
        if (options.citationURL) formData.append('citationURL', options.citationURL);
        if (options.citationTitle) formData.append('citationTitle', options.citationTitle);
        if (options.tags) formData.append('tags', options.tags);
        if (options.format) formData.append('format', options.format);
        if (options.folderId) formData.append('folderId', options.folderId);

        return this._fetch(`/experts/${this.expertId}/knowledges`, {
            method: 'POST',
            body: formData
        });
    }

    /** Adds a new knowledge entry from a URL link or updates an existing one. */
    async addKnowledgeWithLink(sourceURL, options = {}) {
        const payload = { sourceURL };
        if (options.enableSync !== undefined) payload.enableSync = options.enableSync;
        if (options.tags) payload.tags = options.tags;
        if (options.knowledgeId) payload.knowledgeId = options.knowledgeId;
        if (options.folderId) payload.folderId = options.folderId;

        return this._fetch(`/experts/${this.expertId}/knowledges/link`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    /** Updates the citation metadata for a specific knowledge entry. */
    async updateKnowledgeMeta(knowledgeId, citationURL, citationTitle) {
        const payload = { citationURL, citationTitle };
        return this._fetch(`/experts/${this.expertId}/knowledges/${knowledgeId}/meta`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
    }

    /** Updates the access groups attachment for multiple knowledge entries. */
    async updateKnowledgeAccessGroups(knowledgesArray) {
        return this._fetch(`/experts/${this.expertId}/knowledges/groups`, {
            method: 'PUT',
            body: JSON.stringify({ knowledges: knowledgesArray })
        });
    }

    // =====================================
    // TAGS AND FOLDERS
    // =====================================

    /** Lists all unique knowledge tags under the requested expert. */
    async listTags() {
        return this._fetch(`/experts/${this.expertId}/tags`, { method: 'GET' });
    }

    /** Overwrites tags for a specific knowledge entry (empty array to clear all). */
    async setKnowledgeTags(knowledgeId, tagsArray) {
        return this._fetch(`/experts/${this.expertId}/knowledges/${knowledgeId}/tags`, {
            method: 'PUT',
            body: JSON.stringify({ tags: tagsArray })
        });
    }

    /** Lists all folders under the requested expert. */
    async listFolders() {
        return this._fetch(`/experts/${this.expertId}/folders`, { method: 'GET' });
    }

    /** Creates a folder under the requested expert. */
    async createFolder(name) {
        return this._fetch(`/experts/${this.expertId}/folders`, {
            method: 'POST',
            body: JSON.stringify({ name })
        });
    }

    /** Updates a folder under the requested expert. */
    async updateFolder(folderId, name) {
        return this._fetch(`/experts/${this.expertId}/folders/${folderId}`, {
            method: 'PUT',
            body: JSON.stringify({ name })
        });
    }

    /** Deletes a folder under the requested expert (and knowledges under it). */
    async deleteFolder(folderId) {
        return this._fetch(`/experts/${this.expertId}/folders/${folderId}`, { method: 'DELETE' });
    }

    /** Moves knowledges to a folder. */
    async moveKnowledgesToFolder(folderId, knowledgeIdsArray) {
        return this._fetch(`/experts/${this.expertId}/folders/${folderId}/knowledges`, {
            method: 'PUT',
            body: JSON.stringify({ knowledgeIds: knowledgeIdsArray })
        });
    }
}
