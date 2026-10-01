// Bibliotecas
import { Dialog, DialogContent, DialogTitle } from '@radix-ui/react-dialog'
// Estilos e Funções
import './style.css'

export default function PopUp({ open, message, close, confirm, cancel, confirmFnct }) {
  return (
    <Dialog open={open} onOpenChange={(aberto) => { if (!aberto) close(); }}>
      <DialogContent aria-describedby={undefined}>
        <div className='container-popUp'>
          <div className='div-popUpBox'>
            <DialogTitle className='p-popUp'>{message}</DialogTitle>
            <div className="div-popUp-btn">
              <button type="button" className='btn-popUp' onClick={close}>{cancel}</button>
              <button type="button" className='btn-popUp' onClick={confirmFnct}>{confirm}</button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
