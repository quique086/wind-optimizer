/* Safari: ReadableStream is not async-iterable; pdf.js uses `for await` on streams */
(function(){try{if(typeof ReadableStream!=="undefined"&&!ReadableStream.prototype[Symbol.asyncIterator]){
ReadableStream.prototype[Symbol.asyncIterator]=async function*(){const r=this.getReader();try{for(;;){const{done,value}=await r.read();if(done)return;yield value}}finally{try{r.releaseLock()}catch(e){}}};
if(!ReadableStream.prototype.values)ReadableStream.prototype.values=ReadableStream.prototype[Symbol.asyncIterator]}}catch(e){}})();
